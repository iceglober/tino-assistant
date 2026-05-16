import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuth } from '../../src/server/middleware/auth.js';
import type { AppLogger } from '../../src/slack/app.js';

/**
 * Regression test for wave 1, item 1.3 (gap #7):
 * `createAuth` MUST log a loud warning when `BETTER_AUTH_SECRET` is unset.
 *
 * Without a stable secret, every process restart silently invalidates ALL
 * outstanding sessions — even a hypothetical durable session store would not
 * help because better-auth's session-token signature depends on the secret.
 * The warning is the only signal an operator gets that production is mis-
 * configured. This test locks in the warning so future refactors don't drop it
 * (e.g. by reverting to `crypto.randomUUID()` without a log line).
 *
 * Test target: `packages/core/src/server/middleware/auth.ts:40-49`.
 *
 * Mocks: `AppLogger` is stubbed with `vi.fn()` spies; the better-auth backing
 * database is `:memory:` (better-sqlite3 native in-memory mode) so the test
 * never touches the filesystem and runs hermetically.
 */

function spyLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('createAuth — BETTER_AUTH_SECRET warning (gap #7)', () => {
  const originalSecret = process.env['BETTER_AUTH_SECRET'];

  beforeEach(() => {
    delete process.env['BETTER_AUTH_SECRET'];
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env['BETTER_AUTH_SECRET'];
    } else {
      process.env['BETTER_AUTH_SECRET'] = originalSecret;
    }
  });

  it('logs a warning when BETTER_AUTH_SECRET is not set', async () => {
    const logger = spyLogger();

    await createAuth({
      googleClientId: 'test-client-id',
      googleClientSecret: 'test-client-secret',
      baseUrl: 'http://localhost:3000',
      dbPath: ':memory:',
      logger,
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { fix: 'set BETTER_AUTH_SECRET env var (Pulumi: SecretsManager)' },
      'BETTER_AUTH_SECRET not set — sessions will be invalidated on every restart',
    );
  });

  it('does NOT warn when BETTER_AUTH_SECRET is set', async () => {
    process.env['BETTER_AUTH_SECRET'] = 'stable-secret-from-secrets-manager';
    const logger = spyLogger();

    await createAuth({
      googleClientId: 'test-client-id',
      googleClientSecret: 'test-client-secret',
      baseUrl: 'http://localhost:3000',
      dbPath: ':memory:',
      logger,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not throw when no logger is provided and BETTER_AUTH_SECRET is unset', async () => {
    // Optional-chained `opts.logger?.warn(...)` — must not blow up when caller
    // omits the logger (older callers exist; auth.ts:38 marks it optional).
    await expect(
      createAuth({
        googleClientId: 'test-client-id',
        googleClientSecret: 'test-client-secret',
        baseUrl: 'http://localhost:3000',
        dbPath: ':memory:',
      }),
    ).resolves.toBeDefined();
  });
});
