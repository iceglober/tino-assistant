import { Hono } from "hono";

/**
 * GET /api/health — liveness for the load balancer.
 * Public: bypasses auth (ALB target-group health checks are unauthenticated).
 */
export function createHealthRoutes(opts: {
  startTime: number;
  isAuthConfigured?: () => boolean;
}): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      ok: true,
      authConfigured: opts.isAuthConfigured?.() ?? false,
      uptime: (Date.now() - opts.startTime) / 1000,
    }),
  );

  return app;
}
