import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";

/**
 * /api/reload — hot-reload endpoints for Slack, capabilities, and auth.
 *
 * Wave 3:
 *   POST /slack         → reconnectSlack callback; returns { ok, error? }
 *   POST /capabilities  → reloadCapabilities callback; returns { ok, error? }
 * Wave 4:
 *   POST /auth          → reloadAuth callback; returns { ok, error? }
 *                          Bypasses admin check when auth is not yet configured
 *                          (first-boot setup flow).
 *
 * Convention: user-visible failures (bad tokens, unreachable Slack) return
 * HTTP 200 with `{ ok: false, error }` so the console JS can show a toast
 * without treating the failure as a server bug. Genuine server bugs (the
 * callback throws) return HTTP 500.
 */
export function createReloadRoutes(
  opts: {
    reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
    reloadCapabilities?: () => Promise<{ ok: boolean; error?: string }>;
    reloadAuth?: () => Promise<{ ok: boolean; error?: string }>;
    isAuthConfigured?: () => boolean;
    logger?: AppLogger;
    auditLogger?: AuditLogger;
  } = {},
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { reconnectSlack, reloadCapabilities, reloadAuth, isAuthConfigured, logger, auditLogger } = opts;
  const admin = requireAdmin();

  app.post("/slack", admin, async (c) => {
    if (!reconnectSlack) {
      return c.json({ ok: false, error: "slack reload not wired" }, 501);
    }
    try {
      const result = await reconnectSlack();
      logger?.info({ ok: result.ok }, "slack reload requested");
      if (auditLogger) {
        await auditLogger.log({
          userId: c.get("user")?.email ?? "console",
          action: "config_change",
          toolName: "reload.slack",
          status: result.ok ? "success" : "error",
          errorMessage: result.error,
        });
      }
      return c.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      logger?.error({ err: msg }, "slack reload threw");
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.post("/capabilities", admin, async (c) => {
    if (!reloadCapabilities) {
      return c.json({ ok: false, error: "capability reload not wired" }, 501);
    }
    try {
      const result = await reloadCapabilities();
      logger?.info({ ok: result.ok }, "capabilities reload requested");
      if (auditLogger) {
        await auditLogger.log({
          userId: c.get("user")?.email ?? "console",
          action: "config_change",
          toolName: "reload.capabilities",
          status: result.ok ? "success" : "error",
          errorMessage: result.error,
        });
      }
      return c.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      logger?.error({ err: msg }, "capabilities reload threw");
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.post("/auth", async (c) => {
    if (!reloadAuth) {
      return c.json({ ok: false, error: "auth reload not wired" }, 501);
    }
    // During first boot (no auth configured), allow unauthenticated access.
    // Once auth is running, require admin.
    if (isAuthConfigured?.()) {
      const user = c.get("user");
      if (!user || user.role !== "admin") {
        return c.json({ error: "admin required" }, 403);
      }
    }
    try {
      const result = await reloadAuth();
      logger?.info({ ok: result.ok }, "auth reload requested");
      if (auditLogger) {
        await auditLogger.log({
          userId: c.get("user")?.email ?? "setup",
          action: "config_change",
          toolName: "reload.auth",
          status: result.ok ? "success" : "error",
          errorMessage: result.error,
        });
      }
      return c.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      logger?.error({ err: msg }, "auth reload threw");
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  return app;
}
