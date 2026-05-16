/**
 * Wave 3 (v2.2) — § 3.1 server route smoke tests for GET /api/health.
 *
 * Mirrors `admin-routes.test.ts`: mounts the route on a fresh `Hono`,
 * exercises it via `app.request()`, asserts on `res.status` and the
 * parsed body. No real HTTP server, no SQLite — the route is a pure
 * function over `{ startTime, tools, registry }`.
 */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CapabilityRegistry, CapabilityRuntimeState } from "../../src/capabilities/types.js";
import { createHealthRoutes } from "../../src/server/routes/health.js";

function mountHealth(opts: Parameters<typeof createHealthRoutes>[0]): Hono {
  const app = new Hono();
  app.route("/api/health", createHealthRoutes(opts));
  return app;
}

function fakeRegistry(state: Record<string, CapabilityRuntimeState>): CapabilityRegistry {
  return {
    tools: {},
    capabilityIds: Object.keys(state),
    stopAll: vi.fn(),
    getState: vi.fn(() => state),
    reload: vi.fn(async () => ({ ok: true })),
  };
}

describe("GET /api/health", () => {
  it("returns ok with the list of registered tool names", async () => {
    const app = mountHealth({
      startTime: Date.now() - 1000,
      tools: { github_search_code: {}, linear_search_issues: {} },
      registry: undefined,
    });

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      tools: string[];
      uptime: number;
      capabilities: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.tools).toContain("github_search_code");
    expect(body.tools).toContain("linear_search_issues");
    // uptime is reported in seconds and is non-negative.
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    // Without a registry, capabilities is an empty array (not undefined).
    expect(body.capabilities).toEqual([]);
  });

  it("includes per-capability state from the registry", async () => {
    const registry = fakeRegistry({
      github: { toolCount: 4, lastFindWorkScanAt: 1700000000000, lastError: undefined },
      linear: { toolCount: 0, lastFindWorkScanAt: undefined, lastError: "boom" },
    });
    const app = mountHealth({
      startTime: Date.now(),
      tools: {},
      registry,
    });

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      tools: string[];
      capabilities: Array<{ id: string; toolCount: number; lastFindWorkScanAt?: number; lastError?: string }>;
    };
    // No tools registered (registry is independent of opts.tools in this test).
    expect(body.tools).toEqual([]);
    // Capabilities surface both healthy + errored states.
    const ids = body.capabilities.map((c) => c.id).sort();
    expect(ids).toEqual(["github", "linear"]);
    const linear = body.capabilities.find((c) => c.id === "linear");
    expect(linear?.toolCount).toBe(0);
    expect(linear?.lastError).toBe("boom");
    expect(registry.getState).toHaveBeenCalled();
  });
});
