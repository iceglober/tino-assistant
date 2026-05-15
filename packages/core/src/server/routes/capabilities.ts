import { Hono } from 'hono';
import type { ConfigStore } from '../../persistence/config.js';
import type { AppLogger } from '../../slack/app.js';

/**
 * /api/capabilities — list and update capability configs.
 *
 * Mirror:
 *   GET /api/capabilities      → console/server.ts:181-194
 *   PUT /api/capabilities/:id  → console/server.ts:197-226
 *
 * Capabilities are stored as `capability.<id>` keys in the config store.
 */
export function createCapabilityRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
}): Hono {
  const app = new Hono();
  const { config, logger } = opts;

  app.get('/', async (c) => {
    const entries = await config.list();
    const caps = entries
      .filter((e) => e.key.startsWith('capability.'))
      .map((e) => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(e.value);
        } catch {
          /* ignore malformed entries */
        }
        return { id: e.key.slice('capability.'.length), config: parsed, updatedAt: e.updatedAt };
      });
    return c.json(caps);
  });

  app.put('/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    if (!id) return c.json({ error: 'Missing capability id' }, 400);

    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return c.json({ error: 'Request body must be valid JSON' }, 400);
    }

    const key = `capability.${id}`;
    await config.set(key, parsed);
    logger.info({ capabilityId: id }, 'capability config updated via console');
    return c.json({ ok: true, id });
  });

  return app;
}
