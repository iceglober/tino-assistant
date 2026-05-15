import { Hono } from 'hono';

/**
 * /api/reload — hot-reload endpoints for capabilities and Slack connection.
 *
 * Wave 3 fills these in (POST /api/reload/slack, POST /api/reload/capabilities).
 * Wave 0 just stakes out the route file so the wiring in `server/index.ts` is
 * stable across waves.
 */
export function createReloadRoutes(): Hono {
  const app = new Hono();

  // Stub — wave 3 will replace with real reload logic.
  app.post('/slack', (c) => c.json({ ok: false, error: 'not implemented (wave 3)' }, 501));
  app.post('/capabilities', (c) =>
    c.json({ ok: false, error: 'not implemented (wave 3)' }, 501),
  );

  return app;
}
