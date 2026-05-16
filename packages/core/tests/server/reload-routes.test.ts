/**
 * Wave 3.1 — POST /api/reload/slack route.
 * Wave 3.2 — POST /api/reload/capabilities route.
 *
 * The route is a thin shell over caller-supplied callbacks. It:
 *   - returns 501 when no callback was wired (legacy stub behaviour)
 *   - returns HTTP 200 with `{ ok, error? }` when the callback resolves
 *     (user-visible failures don't escalate to 5xx)
 *   - returns HTTP 500 only when the callback itself throws
 *   - audit-logs every call (success or error) when an audit logger is
 *     provided
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createReloadRoutes } from '../../src/server/routes/reload.js';
import { createMemoryAuditLogger } from '../../src/audit/memory.js';
import type { AppLogger } from '../../src/slack/app.js';

function noopLogger(): AppLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function mountReload(opts: Parameters<typeof createReloadRoutes>[0]): Hono {
  const app = new Hono();
  app.route('/api/reload', createReloadRoutes(opts));
  return app;
}

describe('POST /api/reload/slack', () => {
  it('returns 501 when no reconnectSlack callback is wired (regression: wave 0 stub)', async () => {
    const app = mountReload({});
    const res = await app.request('/api/reload/slack', { method: 'POST' });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it('returns 200 + { ok: true } when reconnectSlack succeeds', async () => {
    const reconnectSlack = vi.fn(async () => ({ ok: true }));
    const audit = createMemoryAuditLogger();
    const app = mountReload({ reconnectSlack, logger: noopLogger(), auditLogger: audit });

    const res = await app.request('/api/reload/slack', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(reconnectSlack).toHaveBeenCalledTimes(1);

    // Audit log captured the success.
    const entries = await audit.query({ action: 'config_change' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.toolName).toBe('reload.slack');
    expect(entries[0]!.status).toBe('success');
  });

  it('returns 200 + { ok: false, error } on user-visible failure (invalid tokens)', async () => {
    // Invalid-token path: the reconnect callback resolves cleanly with
    // ok:false. The route MUST return 200 (not 5xx) so the console JS can
    // toast the error without interpreting it as a server bug.
    const reconnectSlack = vi.fn(async () => ({
      ok: false,
      error: 'slack rejected token: invalid_auth',
    }));
    const audit = createMemoryAuditLogger();
    const app = mountReload({ reconnectSlack, logger: noopLogger(), auditLogger: audit });

    const res = await app.request('/api/reload/slack', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('invalid_auth');

    // Audit log captures error status + message.
    const entries = await audit.query({ action: 'config_change' });
    expect(entries[0]!.status).toBe('error');
    expect(entries[0]!.errorMessage).toContain('invalid_auth');
  });

  it('returns 500 only when the callback itself throws (server bug)', async () => {
    const reconnectSlack = vi.fn(async () => {
      throw new Error('boom');
    });
    const app = mountReload({ reconnectSlack, logger: noopLogger() });

    const res = await app.request('/api/reload/slack', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('boom');
  });
});

describe('POST /api/reload/capabilities', () => {
  it('returns 501 when no reloadCapabilities callback is wired', async () => {
    const app = mountReload({});
    const res = await app.request('/api/reload/capabilities', { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('returns 200 + { ok: true } when reloadCapabilities succeeds', async () => {
    const reloadCapabilities = vi.fn(async () => ({ ok: true }));
    const audit = createMemoryAuditLogger();
    const app = mountReload({ reloadCapabilities, logger: noopLogger(), auditLogger: audit });

    const res = await app.request('/api/reload/capabilities', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const entries = await audit.query({ action: 'config_change' });
    expect(entries[0]!.toolName).toBe('reload.capabilities');
  });

  it('returns 200 + { ok: false, error } when callback reports failure', async () => {
    const reloadCapabilities = vi.fn(async () => ({
      ok: false,
      error: 'github capability rejected: 401 unauthorized',
    }));
    const app = mountReload({ reloadCapabilities, logger: noopLogger() });

    const res = await app.request('/api/reload/capabilities', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('401');
  });
});
