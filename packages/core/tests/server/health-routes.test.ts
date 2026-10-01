/**
 * Server route smoke tests for GET /api/health.
 *
 * Burned-down surface: the health route is now just a liveness probe over
 * `{ startTime, isAuthConfigured }` — no tool list, no capability registry.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createHealthRoutes } from "../../src/infrastructure/driving/http/routes/health.js";

function mountHealth(opts: Parameters<typeof createHealthRoutes>[0]): Hono {
  const app = new Hono();
  app.route("/api/health", createHealthRoutes(opts));
  return app;
}

describe("GET /api/health", () => {
  it("returns ok with a non-negative uptime", async () => {
    const app = mountHealth({ startTime: Date.now() - 1000, isAuthConfigured: () => true });

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; authConfigured: boolean; uptime: number };
    expect(body.ok).toBe(true);
    expect(body.authConfigured).toBe(true);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("reports authConfigured=false when auth is not set up", async () => {
    const app = mountHealth({ startTime: Date.now(), isAuthConfigured: () => false });
    const res = await app.request("/api/health");
    const body = (await res.json()) as { authConfigured: boolean };
    expect(body.authConfigured).toBe(false);
  });
});
