/**
 * Wave 2 (v2.2) — per-user capability route tests for:
 *   GET /api/user-capabilities/:userId
 *   PUT /api/user-capabilities/:userId/:capabilityId
 *   DELETE /api/user-capabilities/:userId/:capabilityId
 *
 * Per-user capabilities are stored under `user.<tinoUserId>.capability.<id>` keys.
 * Routes verify that the logged-in user (from auth context) can only access their own
 * data — attempting cross-user access returns 403.
 *
 * Tests verify:
 *   - GET returns user's private capabilities only
 *   - PUT saves to correct namespace and audit-logs
 *   - DELETE removes entry and audit-logs
 *   - 401 returned when no user in context
 *   - 403 returned for cross-user access
 *   - URL decoding works correctly
 *   - Empty lists when no capabilities configured
 */

import { Hono, type Context } from "hono";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createMemoryAuditLogger } from "../../src/audit/memory.js";
import { createUserCapabilityRoutes } from "../../src/server/routes/user-capabilities.js";
import { makeConfigStore, noopLogger } from "./_helpers.js";
import type { AuthVariables } from "../../src/server/middleware/auth.js";

function mountUserCapabilities(
  opts: Parameters<typeof createUserCapabilityRoutes>[0],
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Middleware to set user context for tests
  app.use("*", async (c: Context, next) => {
    const userId = c.req.query("userId");
    if (userId) {
      c.set("user", {
        id: userId,
        email: `${userId}@example.com`,
      });
    }
    await next();
  });

  app.route("/api/user-capabilities", createUserCapabilityRoutes(opts));
  return app;
}

describe("GET /api/user-capabilities/:userId", () => {
  it("returns user's private capabilities", async () => {
    const config = makeConfigStore({
      "user.U001.capability.gmail": {
        enabled: true,
        credentials: { clientId: "cid", clientSecret: "sec", refreshToken: "rt" },
        settings: {},
      },
      // Different user's capability should not appear as enabled
      "user.U002.capability.gmail": {
        enabled: true,
        credentials: { clientId: "cid2" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request("/api/user-capabilities/U001?userId=U001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; enabled: boolean }>;
    // Returns all declared private capabilities (calendar, gmail, mcp, slack-personal)
    expect(body).toHaveLength(4);
    expect(body.map((c) => c.id)).toEqual(["calendar", "gmail", "mcp", "slack-personal"]);
    // Only the one with stored config is enabled
    expect(body.find((c) => c.id === "gmail")?.enabled).toBe(true);
    expect(body.find((c) => c.id === "calendar")?.enabled).toBe(false);
  });

  it("returns all private capability views even when user has none configured", async () => {
    const config = makeConfigStore({
      // Only global capabilities exist
      "capability.github": {
        enabled: true,
        credentials: { clientId: "Iv1.test" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request("/api/user-capabilities/U001?userId=U001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; enabled: boolean }>;
    // All private capabilities returned (unconfigured)
    expect(body).toHaveLength(4);
    for (const cap of body) expect(cap.enabled).toBe(false);
  });

  it("rejects cross-user access with 403", async () => {
    const config = makeConfigStore({
      "user.U001.capability.github": {
        enabled: true,
        credentials: { token: "ghp_user1" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    // Try to access U001's capabilities as U002
    const res = await app.request("/api/user-capabilities/U001?userId=U002");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Forbidden");
  });

  it("rejects requests without auth context with 401", async () => {
    const config = makeConfigStore({});
    const app = new Hono<{ Variables: AuthVariables }>();
    app.route("/api/user-capabilities", createUserCapabilityRoutes({ config, logger: noopLogger() }));

    const res = await app.request("/api/user-capabilities/U001");
    expect(res.status).toBe(401);
  });

  it("decodes URL-encoded user ids", async () => {
    const config = makeConfigStore({
      "user.user@example.com.capability.gmail": {
        enabled: true,
        credentials: { clientId: "cid" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const encoded = encodeURIComponent("user@example.com");
    const res = await app.request(
      `/api/user-capabilities/${encoded}?userId=${encoded}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; enabled: boolean }>;
    // All 4 private capabilities returned; gmail is enabled from stored config
    expect(body).toHaveLength(4);
    expect(body.find((c) => c.id === "gmail")?.enabled).toBe(true);
  });
});

describe("PUT /api/user-capabilities/:userId/:capabilityId", () => {
  it("saves capability config to correct namespace", async () => {
    const config = makeConfigStore({});
    const audit = createMemoryAuditLogger();
    const app = mountUserCapabilities({ config, logger: noopLogger(), auditLogger: audit });

    const payload = {
      enabled: true,
      fields: [{ key: "token", value: "ghp_abc123" }],
    };

    const res = await app.request(
      "/api/user-capabilities/U001/github?userId=U001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify saved to correct key
    const saved = await config.get("user.U001.capability.github");
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved as string) as Record<string, unknown>;
    expect(parsed.enabled).toBe(true);
  });

  it("preserves existing fields when updating", async () => {
    const config = makeConfigStore({
      "user.U001.capability.gmail": {
        enabled: true,
        credentials: { clientId: "old_id", clientSecret: "old_sec", refreshToken: "rt_keep" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    // Update only the clientId field
    const payload = {
      enabled: true,
      fields: [{ key: "clientId", value: "new_id" }],
    };

    const res = await app.request(
      "/api/user-capabilities/U001/gmail?userId=U001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    expect(res.status).toBe(200);

    const saved = await config.get("user.U001.capability.gmail");
    const parsed = JSON.parse(saved as string) as {
      credentials: Record<string, string>;
      settings: Record<string, string>;
    };
    expect(parsed.credentials.clientId).toBe("new_id");
    expect(parsed.credentials.refreshToken).toBe("rt_keep");
  });

  it("audit-logs successful saves", async () => {
    const config = makeConfigStore({});
    const audit = createMemoryAuditLogger();
    const app = mountUserCapabilities({ config, logger: noopLogger(), auditLogger: audit });

    const payload = { enabled: true, fields: [] };
    const res = await app.request(
      "/api/user-capabilities/U001/github?userId=U001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    expect(res.status).toBe(200);

    const entries = await audit.query({ action: "config_change" });
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries.find((e) => e.toolName === "github");
    expect(entry).toBeDefined();
    expect(entry?.userId).toBe("U001@example.com");
    expect(entry?.status).toBe("success");
  });

  it("rejects cross-user modification with 403", async () => {
    const config = makeConfigStore({});
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request(
      "/api/user-capabilities/U001/github?userId=U002",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, fields: [] }),
      },
    );

    expect(res.status).toBe(403);
  });

  it("rejects unknown capabilities with 400", async () => {
    const config = makeConfigStore({});
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request(
      "/api/user-capabilities/U001/nonexistent?userId=U001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, fields: [] }),
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Unknown capability");
  });

  it("rejects invalid JSON body with 400", async () => {
    const config = makeConfigStore({});
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request(
      "/api/user-capabilities/U001/github?userId=U001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("JSON");
  });

  it("decodes URL-encoded capability ids", async () => {
    const config = makeConfigStore({});
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const payload = { enabled: true, fields: [] };
    const res = await app.request(
      `/api/user-capabilities/U001/${encodeURIComponent("github")}?userId=U001`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/user-capabilities/:userId/:capabilityId", () => {
  it("deletes user capability and audit-logs", async () => {
    const config = makeConfigStore({
      "user.U001.capability.github": {
        enabled: true,
        credentials: { token: "ghp_abc123" },
        settings: {},
      },
    });
    const audit = createMemoryAuditLogger();
    const app = mountUserCapabilities({ config, logger: noopLogger(), auditLogger: audit });

    const res = await app.request("/api/user-capabilities/U001/github?userId=U001", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify deleted
    const entry = await config.get("user.U001.capability.github");
    expect(entry).toBeNull();

    // Verify audited
    const auditEntries = await audit.query({ action: "config_change" });
    expect(auditEntries.length).toBeGreaterThan(0);
    const ghEntry = auditEntries.find((e) => e.toolName === "github");
    expect(ghEntry).toBeDefined();
  });

  it("succeeds even if capability doesn't exist (idempotent)", async () => {
    const config = makeConfigStore({});
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request("/api/user-capabilities/U001/github?userId=U001", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
  });

  it("only deletes target user's capability, not others'", async () => {
    const config = makeConfigStore({
      "user.U001.capability.github": {
        enabled: true,
        credentials: { token: "ghp_user1" },
        settings: {},
      },
      "user.U002.capability.github": {
        enabled: true,
        credentials: { token: "ghp_user2" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request("/api/user-capabilities/U001/github?userId=U001", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    // U001's is gone
    expect(await config.get("user.U001.capability.github")).toBeNull();
    // U002's is still there
    expect(await config.get("user.U002.capability.github")).not.toBeNull();
  });

  it("rejects cross-user deletion with 403", async () => {
    const config = makeConfigStore({
      "user.U001.capability.github": {
        enabled: true,
        credentials: { token: "ghp_abc123" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const res = await app.request("/api/user-capabilities/U001/github?userId=U002", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    // Verify not actually deleted
    expect(await config.get("user.U001.capability.github")).not.toBeNull();
  });

  it("works without audit logger (no throw)", async () => {
    const config = makeConfigStore({
      "user.U001.capability.github": {
        enabled: true,
        credentials: { token: "ghp_abc123" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger(), auditLogger: undefined });

    const res = await app.request("/api/user-capabilities/U001/github?userId=U001", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await config.get("user.U001.capability.github")).toBeNull();
  });

  it("decodes URL-encoded user ids and capability ids", async () => {
    const config = makeConfigStore({
      "user.user@example.com.capability.github": {
        enabled: true,
        credentials: { token: "ghp_abc123" },
        settings: {},
      },
    });
    const app = mountUserCapabilities({ config, logger: noopLogger() });

    const userId = encodeURIComponent("user@example.com");
    const capId = encodeURIComponent("github");
    const res = await app.request(
      `/api/user-capabilities/${userId}/${capId}?userId=${decodeURIComponent(userId)}`,
      {
        method: "DELETE",
      },
    );

    expect(res.status).toBe(200);
    expect(await config.get("user.user@example.com.capability.github")).toBeNull();
  });
});
