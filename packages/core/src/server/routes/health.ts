import { Hono } from "hono";
import type { CapabilityRegistry } from "../../capabilities/types.js";

/**
 * GET /api/health — liveness + tool/capability summary for the ALB.
 *
 * Mirror: `console/server.ts:83-99`.
 *
 * Public: bypasses auth middleware (allowed by ALB target-group health checks).
 */
export function createHealthRoutes(opts: {
  startTime: number;
  tools: Record<string, unknown>;
  registry: CapabilityRegistry | undefined;
  isAuthConfigured?: () => boolean;
}): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const capState = opts.registry?.getState() ?? {};
    return c.json({
      ok: true,
      authConfigured: opts.isAuthConfigured?.() ?? false,
      tools: Object.keys(opts.tools),
      uptime: (Date.now() - opts.startTime) / 1000,
      capabilities: Object.entries(capState).map(([id, s]) => ({
        id,
        toolCount: s.toolCount,
        lastFindWorkScanAt: s.lastFindWorkScanAt,
        lastError: s.lastError,
      })),
    });
  });

  return app;
}
