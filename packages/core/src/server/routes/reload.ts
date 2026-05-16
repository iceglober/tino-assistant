import { Hono } from 'hono';
import type { AuditLogger } from '../../audit/logger.js';
import type { AppLogger } from '../../slack/app.js';

/**
 * /api/reload — hot-reload endpoints for Slack connection and capabilities.
 *
 * Mirror: the route-handler shape at `routes/config.ts:30-55`
 *   (`readBody → action → JSON response`) and the audit-log shape at
 *   `routes/config.ts:46-53`.
 *
 * Wave 3:
 *   POST /slack         → reconnectSlack callback; returns { ok, error? }
 *   POST /capabilities  → reloadCapabilities callback; returns { ok, error? }
 *
 * Convention: user-visible failures (bad tokens, unreachable Slack) return
 * HTTP 200 with `{ ok: false, error }` so the console JS can show a toast
 * without treating the failure as a server bug. Genuine server bugs (the
 * callback throws) return HTTP 500.
 */
export function createReloadRoutes(opts: {
  reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
  reloadCapabilities?: () => Promise<{ ok: boolean; error?: string }>;
  logger?: AppLogger;
  auditLogger?: AuditLogger;
} = {}): Hono {
  const app = new Hono();
  const { reconnectSlack, reloadCapabilities, logger, auditLogger } = opts;

  app.post('/slack', async (c) => {
    if (!reconnectSlack) {
      return c.json({ ok: false, error: 'slack reload not wired' }, 501);
    }
    try {
      const result = await reconnectSlack();
      logger?.info({ ok: result.ok }, 'slack reload requested');
      if (auditLogger) {
        await auditLogger.log({
          userId: 'console',
          action: 'config_change',
          toolName: 'reload.slack',
          status: result.ok ? 'success' : 'error',
          errorMessage: result.error,
        });
      }
      return c.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      logger?.error({ err: msg }, 'slack reload threw');
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.post('/capabilities', async (c) => {
    if (!reloadCapabilities) {
      return c.json({ ok: false, error: 'capability reload not wired' }, 501);
    }
    try {
      const result = await reloadCapabilities();
      logger?.info({ ok: result.ok }, 'capabilities reload requested');
      if (auditLogger) {
        await auditLogger.log({
          userId: 'console',
          action: 'config_change',
          toolName: 'reload.capabilities',
          status: result.ok ? 'success' : 'error',
          errorMessage: result.error,
        });
      }
      return c.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      logger?.error({ err: msg }, 'capabilities reload threw');
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  return app;
}
