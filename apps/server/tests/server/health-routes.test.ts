import { describe, expect, it } from "vitest";
import { createHealthRoutes } from "../../src/infrastructure/driving/http/routes/health.js";

describe("GET /api/health", () => {
  it("returns ok with a non-negative uptime", async () => {
    const res = await createHealthRoutes({ startTime: Date.now() }).request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; uptime: number };
    expect(body.ok).toBe(true);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});
