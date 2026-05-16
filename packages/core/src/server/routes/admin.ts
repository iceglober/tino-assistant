import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { AppLogger } from "../../slack/app.js";

/**
 * /api/admin — admin-only operational endpoints.
 *
 * Mirror: the factory shape at `routes/users.ts:16-55` (audit-log + JSON
 * response). Auth-gated by the global middleware at `server/index.ts:102`.
 *
 * Wave 3.4 — POST /restart:
 *   - audit-log an `admin_restart` entry
 *   - send 202 Accepted with `{ ok: true }` so the response flushes BEFORE
 *     the process exits
 *   - schedule the in-process `shutdown` callback on the next tick (100ms)
 *     so scheduler / registry / Slack-app teardown runs before `process.exit`
 *
 * Why a callback (not raw `process.exit`)? The callback is the named
 * `shutdown` from `index.ts` — it stops the scheduler, clears findWork
 * pollers, closes the HTTP server, and stops the Slack app before exiting.
 * Calling `process.exit(0)` directly would skip all of that and leak
 * resources during the rolling restart.
 */
export function createAdminRoutes(opts: {
  logger: AppLogger;
  auditLogger: AuditLogger | undefined;
  shutdown: (signal: string) => Promise<void> | void;
}): Hono {
  const app = new Hono();
  const { logger, auditLogger, shutdown } = opts;

  app.post("/restart", async (c) => {
    if (auditLogger) {
      await auditLogger.log({
        userId: "console",
        action: "admin_restart",
        status: "success",
      });
    }
    logger.info("admin restart requested via console");

    // Defer the actual shutdown so the 202 response flushes first.
    setTimeout(() => {
      void Promise.resolve(shutdown("admin")).catch((err: unknown) => {
        logger.error({ err: (err as Error).message }, "shutdown callback threw");
      });
    }, 100);

    return c.json({ ok: true }, 202);
  });

  return app;
}
