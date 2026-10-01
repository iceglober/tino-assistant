import { mcpToolName, mcpUrlProblem } from "@tino/core/domain/mcp";
import type { CapabilityConfig } from "@tino/core/domain/types";
import { everyoneInWorkspace, onlyUser } from "@tino/core/domain/who-can-see";
import type { UserCapabilityStore } from "@tino/core/ports/outbound";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { McpClientPool } from "../../src/infrastructure/driven/mcp/client-pool.js";
import { createMcpServerStore } from "../../src/infrastructure/driven/mcp/store.js";
import { mcpToolGroups } from "../../src/infrastructure/driven/tools/mcp.js";
import type { AuthVariables } from "../../src/infrastructure/driving/http/auth.js";
import { createMcpRoutes } from "../../src/infrastructure/driving/http/routes/mcp.js";
import { noopLogger } from "../server/_helpers.js";

function memCaps(): UserCapabilityStore {
  const rows = new Map<string, CapabilityConfig>();
  const k = (u: string, c: string) => `${u}|${c}`;
  return {
    get: async (u, c) => rows.get(k(u, c)) ?? null,
    set: async (u, c, cfg) => void rows.set(k(u, c), cfg),
    list: async (u) =>
      [...rows.entries()]
        .filter(([key]) => key.startsWith(`${u}|`))
        .map(([key, cfg]) => ({ capabilityId: key.split("|")[1] as string, enabled: cfg.enabled })),
    delete: async (u, c) => rows.delete(k(u, c)),
  };
}

describe("mcp domain rules", () => {
  it("namespaces and sanitizes tool names to 64 chars", () => {
    expect(mcpToolName("linear-prod", "list issues")).toBe("mcp_linear_prod_list_issues");
    expect(mcpToolName("x", "a".repeat(100))).toHaveLength(64);
  });

  it("rejects non-https and private hosts", () => {
    expect(mcpUrlProblem("https://mcp.linear.app/mcp")).toBeNull();
    expect(mcpUrlProblem("http://mcp.linear.app/mcp")).toBe("mcp_url_must_be_https");
    for (const bad of [
      "https://localhost/mcp",
      "https://127.0.0.1/",
      "https://10.1.2.3/",
      "https://169.254.169.254/",
      "https://192.168.0.1/",
      "https://[::1]/",
      "https://metadata.google.internal/",
    ]) {
      expect(mcpUrlProblem(bad)).toBe("mcp_url_private_host");
    }
    expect(mcpUrlProblem("not a url")).toBe("mcp_url_invalid");
  });
});

describe("mcp server store + tool groups", () => {
  const base = { url: "https://example.com/mcp", transport: "http" as const, auth: { kind: "none" as const } };

  it("one group per enabled server, labelled by who may see its results", async () => {
    const store = createMcpServerStore(memCaps(), "org:o1");
    await store.save("admin", {
      ...base,
      id: "ws-private",
      scope: "workspace",
      name: "HR",
      enabled: true,
      resultsVisibleTo: "asker",
    });
    await store.save("admin", {
      ...base,
      id: "ws-shared",
      scope: "workspace",
      name: "Linear",
      enabled: true,
      resultsVisibleTo: "workspace",
    });
    await store.save("u1", {
      ...base,
      id: "mine",
      scope: "personal",
      name: "Mine",
      enabled: true,
      token: "t",
      resultsVisibleTo: "workspace",
    });
    await store.save("u1", {
      ...base,
      id: "off",
      scope: "personal",
      name: "Off",
      enabled: false,
      resultsVisibleTo: "asker",
    });
    await store.save("u2", {
      ...base,
      id: "theirs",
      scope: "personal",
      name: "Theirs",
      enabled: true,
      resultsVisibleTo: "asker",
    });

    const pool = {
      tools: vi.fn(async (_owner: string, s: { id: string }) => ({ [`${s.id}_tool`]: {} })),
    } as unknown as McpClientPool;
    const groups = await mcpToolGroups("u1", { servers: store, pool });
    const byName = Object.fromEntries(groups.map((g) => [g.name, g.whoCanSeeResults]));
    expect(byName).toEqual({
      "mcp:workspace:ws-private": onlyUser("u1"),
      "mcp:workspace:ws-shared": everyoneInWorkspace,
      // A personal server is private even if its stored settings say otherwise.
      "mcp:personal:mine": onlyUser("u1"),
    });
    // Listing groups connects to nothing; building one connects to that server only.
    expect(pool.tools).not.toHaveBeenCalled();
    const shared = groups.find((g) => g.name === "mcp:workspace:ws-shared");
    expect(Object.keys(await shared!.build())).toEqual(["mcp_ws_shared_ws-shared_tool"]);
    expect(pool.tools).toHaveBeenCalledWith("org:o1", expect.objectContaining({ id: "ws-shared" }));
  });

  it("an unreachable server builds to nothing", async () => {
    const store = createMcpServerStore(memCaps(), "org:o1");
    await store.save("u1", {
      ...base,
      id: "down",
      scope: "personal",
      name: "Down",
      enabled: true,
      resultsVisibleTo: "asker",
    });
    const pool = { tools: vi.fn(async () => null) } as unknown as McpClientPool;
    const [group] = await mcpToolGroups("u1", { servers: store, pool });
    expect(await group!.build()).toEqual({});
  });

  it("keeps the token encrypted-store side, not in settings", async () => {
    const caps = memCaps();
    const store = createMcpServerStore(caps, "org:o1");
    await store.save("u1", {
      ...base,
      id: "mine",
      scope: "personal",
      name: "Mine",
      enabled: true,
      token: "t",
      resultsVisibleTo: "asker",
    });
    const raw = await caps.get("u1", "mcp.mine");
    expect(raw?.credentials).toEqual({ token: "t" });
    expect(JSON.stringify(raw?.settings)).not.toContain('"t"');
  });
});

describe("/api/mcp", () => {
  function setup(role: "admin" | "member") {
    const store = createMcpServerStore(memCaps(), "org:o1");
    const pool = {
      probe: vi.fn(async () => ["a", "b"]),
      evict: vi.fn(async () => {}),
    } as unknown as McpClientPool;
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", { id: "u1", email: "u@acme.io", name: null, role, status: "active", slackUserId: null });
      c.set("org", { mcpServers: store } as unknown as AuthVariables["org"]);
      await next();
    });
    app.route("/api/mcp", createMcpRoutes({ pool, logger: noopLogger() }));
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`/api/mcp${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { call, store, pool };
  }

  it("members can add personal servers but not workspace ones", async () => {
    const { call } = setup("member");
    const body = { name: "Linear", url: "https://mcp.linear.app/mcp", auth: { kind: "bearer" }, token: "secret" };
    expect((await call("PUT", "/servers/workspace/linear", body)).status).toBe(403);
    const res = await call("PUT", "/servers/personal/linear", body);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Record<string, unknown>;
    expect(saved.hasToken).toBe(true);
    expect(saved.token).toBeUndefined();
  });

  it("keeps the stored token when an update omits it, and never returns it", async () => {
    const { call, store } = setup("admin");
    await call("PUT", "/servers/workspace/gh", {
      url: "https://api.example.com/mcp",
      auth: { kind: "bearer" },
      token: "t1",
    });
    await call("PUT", "/servers/workspace/gh", { name: "GitHub" });
    expect((await store.get("workspace", "u1", "gh"))?.token).toBe("t1");
    const list = (await (await call("GET", "/servers")).json()) as { workspace: Array<Record<string, unknown>> };
    expect(list.workspace[0]).toMatchObject({ id: "gh", name: "GitHub", hasToken: true });
    expect(JSON.stringify(list)).not.toContain("t1");
  });

  it("only workspace servers can be marked shareable; the default is private to the asker", async () => {
    const { call } = setup("admin");
    const ws = (await (await call("PUT", "/servers/workspace/a", { url: "https://a.example.com" })).json()) as Record<
      string,
      unknown
    >;
    expect(ws.resultsVisibleTo).toBe("asker");
    const shared = (await (
      await call("PUT", "/servers/workspace/a", { resultsVisibleTo: "workspace" })
    ).json()) as Record<string, unknown>;
    expect(shared.resultsVisibleTo).toBe("workspace");
    const personal = (await (
      await call("PUT", "/servers/personal/b", { url: "https://b.example.com", resultsVisibleTo: "workspace" })
    ).json()) as Record<string, unknown>;
    expect(personal.resultsVisibleTo).toBe("asker");
  });

  it("rejects unsafe urls, bad ids, and ids used in the other scope", async () => {
    const { call } = setup("admin");
    expect((await call("PUT", "/servers/personal/x", { url: "https://10.0.0.1/mcp" })).status).toBe(400);
    expect((await call("PUT", "/servers/personal/Bad_Id", { url: "https://a.example.com" })).status).toBe(400);
    await call("PUT", "/servers/workspace/dup", { url: "https://a.example.com" });
    expect((await call("PUT", "/servers/personal/dup", { url: "https://a.example.com" })).status).toBe(409);
  });

  it("test connects without saving", async () => {
    const { call, store } = setup("member");
    const res = await call("POST", "/test", { url: "https://a.example.com/mcp" });
    expect(await res.json()).toEqual({ ok: true, tools: ["a", "b"] });
    expect(await store.listFor("u1")).toEqual([]);
  });
});
