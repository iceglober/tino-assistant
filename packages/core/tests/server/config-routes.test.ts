/**
 * Wave 3 (v2.2) — § 3.1 server route tests for /api/config.
 *
 * GET    /api/config       → list entries
 * PUT    /api/config/:key  → write + audit + return { ok: true, key }
 * DELETE /api/config/:key  → write audit on hit, return { ok: true, deleted }
 *
 * Mirrors `admin-routes.test.ts`: real Hono mount, real route, in-memory
 * ConfigStore + memory audit logger. The store/logger doubles let us assert
 * that every write fires an audit entry.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMemoryAuditLogger } from "../../src/audit/memory.js";
import { createConfigRoutes } from "../../src/server/routes/config.js";
import { makeConfigStore, noopLogger } from "./_helpers.js";

function mountConfig(opts: Parameters<typeof createConfigRoutes>[0]): Hono {
  const app = new Hono();
  app.route("/api/config", createConfigRoutes(opts));
  return app;
}

describe("GET /api/config", () => {
  it("returns the list of stored entries", async () => {
    const config = makeConfigStore({ "bedrock.modelId": "claude-3-5-sonnet" });
    const app = mountConfig({ config, logger: noopLogger(), auditLogger: undefined });

    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ key: string; value: string; updatedAt: number }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.key).toBe("bedrock.modelId");
  });

  it("returns an empty array when the store is empty", async () => {
    const app = mountConfig({ config: makeConfigStore(), logger: noopLogger(), auditLogger: undefined });
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("PUT /api/config/:key", () => {
  it("writes the value, audit-logs, and returns { ok: true, key }", async () => {
    const config = makeConfigStore();
    const audit = createMemoryAuditLogger();
    const app = mountConfig({ config, logger: noopLogger(), auditLogger: audit });

    const res = await app.request("/api/config/bedrock.modelId", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "claude-3-5-sonnet" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: "bedrock.modelId" });

    // Round-tripped via the store.
    const stored = await config.get("bedrock.modelId");
    expect(stored).toBe(JSON.stringify("claude-3-5-sonnet"));

    // Audit-logged the change.
    const entries = await audit.query({ action: "config_change" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolName).toBe("bedrock.modelId");
    expect(entries[0]?.userId).toBe("console");
    expect(entries[0]?.status).toBe("success");
  });

  it("returns 400 when the body is missing the value field", async () => {
    const app = mountConfig({ config: makeConfigStore(), logger: noopLogger(), auditLogger: undefined });

    const res = await app.request("/api/config/foo", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notValue: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/value/);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const app = mountConfig({ config: makeConfigStore(), logger: noopLogger(), auditLogger: undefined });

    const res = await app.request("/api/config/foo", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/JSON/);
  });
});

describe("DELETE /api/config/:key", () => {
  it("removes the entry, audit-logs, and returns deleted=true", async () => {
    const config = makeConfigStore({ "bedrock.modelId": "claude" });
    const audit = createMemoryAuditLogger();
    const app = mountConfig({ config, logger: noopLogger(), auditLogger: audit });

    const res = await app.request("/api/config/bedrock.modelId", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true });

    expect(await config.get("bedrock.modelId")).toBeNull();

    const entries = await audit.query({ action: "config_change" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolName).toBe("bedrock.modelId");
  });

  it("returns deleted=false and skips audit when the key did not exist", async () => {
    const config = makeConfigStore();
    const audit = createMemoryAuditLogger();
    const app = mountConfig({ config, logger: noopLogger(), auditLogger: audit });

    const res = await app.request("/api/config/missing.key", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: false });

    // No audit entry written for a no-op delete.
    expect(await audit.count()).toBe(0);
  });
});
