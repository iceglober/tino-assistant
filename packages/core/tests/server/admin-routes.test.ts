/**
 * Wave 3.4 — POST /api/admin/restart route.
 *
 * Acceptance items in `docs/plans/v2_1/wave_3.md` § 3.4:
 *   - regression test: route calls the injected `shutdown` callback AFTER
 *     returning 202. Mock the callback and assert the response is sent
 *     first, then the callback fires on the next tick.
 *   - audit-logs an `admin_restart` entry.
 *
 * The route deliberately decouples response-flush from process exit:
 *   1. Audit-log
 *   2. Send 202 + { ok: true }
 *   3. Schedule shutdown via setTimeout(..., 100ms) so the response leaves
 *      the wire before the process tears down.
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAdminRoutes } from '../../src/server/routes/admin.js';
import { createMemoryAuditLogger } from '../../src/audit/memory.js';
import type { AppLogger } from '../../src/slack/app.js';

function noopLogger(): AppLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function mountAdmin(opts: Parameters<typeof createAdminRoutes>[0]): Hono {
  const app = new Hono();
  app.route('/api/admin', createAdminRoutes(opts));
  return app;
}

describe('POST /api/admin/restart (wave 3.4)', () => {
  it('returns 202 with { ok: true } before the shutdown callback fires', async () => {
    vi.useFakeTimers();
    try {
      const shutdown = vi.fn(async () => {});
      const audit = createMemoryAuditLogger();
      const app = mountAdmin({ logger: noopLogger(), auditLogger: audit, shutdown });

      const res = await app.request('/api/admin/restart', { method: 'POST' });

      // Response is fully formed BEFORE shutdown runs.
      expect(res.status).toBe(202);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // Shutdown has NOT been called yet (the route deferred via setTimeout).
      expect(shutdown).not.toHaveBeenCalled();

      // Advance fake timers past the 100ms defer.
      await vi.advanceTimersByTimeAsync(150);
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(shutdown).toHaveBeenCalledWith('admin');
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit-logs an admin_restart entry attributed to the console', async () => {
    vi.useFakeTimers();
    try {
      const shutdown = vi.fn(async () => {});
      const audit = createMemoryAuditLogger();
      const app = mountAdmin({ logger: noopLogger(), auditLogger: audit, shutdown });

      await app.request('/api/admin/restart', { method: 'POST' });

      const entries = await audit.query({ action: 'admin_restart' });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.userId).toBe('console');
      expect(entries[0]!.status).toBe('success');

      await vi.advanceTimersByTimeAsync(150);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not throw when shutdown callback rejects (logs the error instead)', async () => {
    // A buggy shutdown shouldn't crash the response path — the response is
    // already sent by the time shutdown fires. The error logger captures it.
    vi.useFakeTimers();
    try {
      const shutdown = vi.fn(async () => { throw new Error('teardown failed'); });
      const errorLog = vi.fn();
      const logger: AppLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: errorLog };
      const audit = createMemoryAuditLogger();
      const app = mountAdmin({ logger, auditLogger: audit, shutdown });

      const res = await app.request('/api/admin/restart', { method: 'POST' });
      expect(res.status).toBe(202);

      await vi.advanceTimersByTimeAsync(150);
      // The throw was caught and logged.
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({ err: 'teardown failed' }),
        expect.stringContaining('shutdown callback threw'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits audit logging when no auditLogger is provided', async () => {
    vi.useFakeTimers();
    try {
      const shutdown = vi.fn(async () => {});
      const app = mountAdmin({ logger: noopLogger(), auditLogger: undefined, shutdown });

      const res = await app.request('/api/admin/restart', { method: 'POST' });
      expect(res.status).toBe(202);

      await vi.advanceTimersByTimeAsync(150);
      expect(shutdown).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
