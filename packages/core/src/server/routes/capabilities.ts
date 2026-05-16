import { Hono } from 'hono';
import type { ConfigStore } from '../../persistence/config.js';
import type { AppLogger } from '../../slack/app.js';
import type { CapabilityConfig } from '../../capabilities/types.js';
import { ALL_CAPABILITIES } from '../../capabilities/all.js';
import { buildCapabilityView, buildConfigFromPayload, findCapability } from '../../capabilities/schema.js';

/**
 * /api/capabilities — list and update capability configs.
 *
 * Mirror:
 *   GET /api/capabilities      → console/server.ts:181-194
 *   PUT /api/capabilities/:id  → console/server.ts:197-226
 *
 * Capabilities are stored as `capability.<id>` keys in the config store.
 *
 * GET merges each module's `fieldSchema` with the stored blob so the console
 * can render a card for every capability — even those without a stored entry
 * yet. PUT accepts either the schema-driven `{ enabled, fields: [{key,value}] }`
 * shape (preferred) or a raw `CapabilityConfig` blob (legacy passthrough).
 */
export function createCapabilityRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
}): Hono {
  const app = new Hono();
  const { config, logger } = opts;

  app.get('/', async (c) => {
    const entries = await config.list();
    const stored = new Map<string, { config: CapabilityConfig | null; updatedAt: number }>();
    for (const e of entries) {
      if (!e.key.startsWith('capability.')) continue;
      const id = e.key.slice('capability.'.length);
      let parsed: CapabilityConfig | null = null;
      try {
        parsed = JSON.parse(e.value) as CapabilityConfig;
      } catch {
        // Malformed JSON: surface an empty config so the card still renders.
      }
      stored.set(id, { config: parsed, updatedAt: e.updatedAt });
    }

    // Always return one entry per known capability module, in declaration order.
    const views = ALL_CAPABILITIES.map((cap) => {
      const s = stored.get(cap.id);
      return buildCapabilityView(cap, s?.config ?? null, s?.updatedAt);
    });
    return c.json(views);
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

    const cap = findCapability(id);
    if (!cap) return c.json({ error: `Unknown capability: ${id}` }, 400);

    // Read the existing blob so unknown fields (findWork, awsProfile, …) survive
    // a save that only updates schema-declared fields.
    let existing: CapabilityConfig | null = null;
    const raw = await config.get(`capability.${id}`);
    if (raw) {
      try {
        existing = JSON.parse(raw) as CapabilityConfig;
      } catch {
        existing = null;
      }
    }

    const next = buildConfigFromPayload(cap, parsed, existing);
    await config.set(`capability.${id}`, next);
    logger.info({ capabilityId: id }, 'capability config updated via console');
    return c.json({ ok: true, id });
  });

  return app;
}
