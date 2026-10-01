/**
 * Server route tests for /api/config.
 *
 * GET    /api/config       → list entries
 * PUT    /api/config/:key  → write + return { ok: true, key }
 * DELETE /api/config/:key  → return { ok: true, deleted }
 *
 * Auth-gated by the top-level middleware; `fakeAdmin()` supplies a signed-in
 * user. Burned-down surface: no audit logger.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createConfigRoutes } from "../../src/infrastructure/driving/http/routes/config.js";
import { fakeAdmin, makeConfigStore, noopLogger } from "./_helpers.js";

function mountConfig(opts: Parameters<typeof createConfigRoutes>[0]): Hono {
  const app = new Hono();
  app.use("*", fakeAdmin());
  app.route("/api/config", createConfigRoutes(opts));
  return app;
}

describe("GET /api/config", () => {
  it("returns the list of stored entries", async () => {
    const config = makeConfigStore({ "azure.deployment": "gpt-4o" });
    const app = mountConfig({ config, logger: noopLogger() });

    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ key: string; value: string; updatedAt: number }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.key).toBe("azure.deployment");
  });

  it("returns an empty array when the store is empty", async () => {
    const app = mountConfig({ config: makeConfigStore(), logger: noopLogger() });
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("PUT /api/config/:key", () => {
  it("writes the value and returns { ok: true, key }", async () => {
    const config = makeConfigStore();
    const app = mountConfig({ config, logger: noopLogger() });

    const res = await app.request("/api/config/azure.deployment", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "gpt-4o" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: "azure.deployment" });

    // Round-tripped via the store.
    const stored = await config.get("azure.deployment");
    expect(stored).toBe(JSON.stringify("gpt-4o"));
  });

  it("returns 400 when the body is missing the value field", async () => {
    const app = mountConfig({ config: makeConfigStore(), logger: noopLogger() });

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
    const app = mountConfig({ config: makeConfigStore(), logger: noopLogger() });

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
  it("removes the entry and returns deleted=true", async () => {
    const config = makeConfigStore({ "azure.deployment": "gpt-4o" });
    const app = mountConfig({ config, logger: noopLogger() });

    const res = await app.request("/api/config/azure.deployment", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(await config.get("azure.deployment")).toBeNull();
  });

  it("returns deleted=false when the key did not exist", async () => {
    const config = makeConfigStore();
    const app = mountConfig({ config, logger: noopLogger() });

    const res = await app.request("/api/config/missing.key", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: false });
  });
});
