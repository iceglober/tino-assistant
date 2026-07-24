/**
 * /api/mcp route tests — credential masking on GET, SSRF validation + persistence
 * on POST, the "Test connection" probe, and that DELETE actually kills the pool
 * connection (the wiring bug this refactor fixed).
 */
import { type Context, Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import type { MCPPool } from "../../src/mcp/pool.js";
import type { UserCapabilityStore } from "../../src/persistence/user-capabilities.js";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createMcpRoutes } from "../../src/server/routes/mcp.js";
import { noopLogger } from "./_helpers.js";

function memUserCaps(seed: Record<string, Record<string, CapabilityConfig>> = {}): UserCapabilityStore {
  const store = new Map<string, Map<string, CapabilityConfig>>(
    Object.entries(seed).map(([u, caps]) => [u, new Map(Object.entries(caps))]),
  );
  return {
    async get(userId, capId) {
      return store.get(userId)?.get(capId) ?? null;
    },
    async set(userId, capId, config) {
      if (!store.has(userId)) store.set(userId, new Map());
      store.get(userId)?.set(capId, config);
    },
    async list(userId) {
      return [...(store.get(userId)?.entries() ?? [])].map(([capabilityId, c]) => ({
        capabilityId,
        enabled: c.enabled,
      }));
    },
    async delete(userId, capId) {
      store.get(userId)?.delete(capId);
    },
  };
}

function mount(opts: Parameters<typeof createMcpRoutes>[0]): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c: Context, next) => {
    c.set("user", { id: "U1", email: "u1@example.com" });
    await next();
  });
  app.route("/api/mcp", createMcpRoutes(opts));
  return app;
}

describe("GET /api/mcp/servers", () => {
  it("masks credentials, exposing only non-secret config + hasCredentials", async () => {
    const userCapabilities = memUserCaps({
      U1: {
        "mcp.acme": {
          enabled: true,
          credentials: { token: "super-secret" },
          settings: {
            url: "https://mcp.acme.dev",
            transport: "streamable-http",
            displayName: "Acme",
            auth: { kind: "bearer" },
          },
        },
      },
    });
    const app = mount({ config: {} as never, logger: noopLogger(), userCapabilities });
    const res = await app.request("/api/mcp/servers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    const s = body[0];
    expect(s.serverId).toBe("acme");
    expect(s.url).toBe("https://mcp.acme.dev");
    expect(s.transport).toBe("streamable-http");
    expect(s.hasCredentials).toBe(true);
    // The raw secret must never appear anywhere in the response.
    expect(JSON.stringify(body)).not.toContain("super-secret");
  });
});

describe("POST /api/mcp/servers/:id", () => {
  it("rejects a private/loopback remote URL (SSRF guard)", async () => {
    const userCapabilities = memUserCaps();
    const app = mount({ config: {} as never, logger: noopLogger(), userCapabilities });
    const res = await app.request("/api/mcp/servers/evil", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        credentials: {},
        settings: { url: "https://127.0.0.1", transport: "sse" },
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("mcp_url_private_host_blocked");
  });

  it("persists a valid remote server", async () => {
    const userCapabilities = memUserCaps();
    const app = mount({ config: {} as never, logger: noopLogger(), userCapabilities });
    const res = await app.request("/api/mcp/servers/acme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        credentials: { token: "t" },
        settings: { url: "https://mcp.acme.dev", transport: "streamable-http" },
      }),
    });
    expect(res.status).toBe(200);
    expect(await userCapabilities.get("U1", "mcp.acme")).not.toBeNull();
  });
});

describe("POST /api/mcp/test", () => {
  it("probes the server via the pool and returns discovered tools", async () => {
    const probe = vi.fn().mockResolvedValue(["search_docs", "get_page"]);
    const pool = { probe } as unknown as MCPPool;
    const app = mount({ config: {} as never, logger: noopLogger(), userCapabilities: memUserCaps(), pool });
    const res = await app.request("/api/mcp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://mcp.acme.dev",
        transport: "streamable-http",
        auth: { kind: "bearer" },
        credentials: { token: "t" },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tools: string[] };
    expect(body.ok).toBe(true);
    expect(body.tools).toEqual(["search_docs", "get_page"]);
    expect(probe).toHaveBeenCalledOnce();
  });

  it("rejects a loopback URL before probing", async () => {
    const probe = vi.fn();
    const pool = { probe } as unknown as MCPPool;
    const app = mount({ config: {} as never, logger: noopLogger(), userCapabilities: memUserCaps(), pool });
    const res = await app.request("/api/mcp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://localhost", transport: "sse" }),
    });
    expect(res.status).toBe(400);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/mcp/servers/:id", () => {
  it("deletes the config and kills the pool connection", async () => {
    const userCapabilities = memUserCaps({
      U1: { "mcp.acme": { enabled: true, credentials: {}, settings: {} } },
    });
    const kill = vi.fn().mockResolvedValue(undefined);
    const pool = { kill } as unknown as MCPPool;
    const app = mount({ config: {} as never, logger: noopLogger(), userCapabilities, pool });
    const res = await app.request("/api/mcp/servers/acme", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await userCapabilities.get("U1", "mcp.acme")).toBeNull();
    // The wiring bug this refactor fixed: DELETE must reach the pool.
    expect(kill).toHaveBeenCalledWith("U1", "acme");
  });
});
