import { Hono } from "hono";

/** GET /api/health — liveness for Railway's health check. Public, and says nothing about orgs. */
export function createHealthRoutes(opts: { startTime: number }): Hono {
  const app = new Hono();
  app.get("/", (c) => c.json({ ok: true, uptime: (Date.now() - opts.startTime) / 1000 }));
  return app;
}
