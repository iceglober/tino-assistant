import { Hono } from "hono";
import type { Logger } from "@tino/core/ports/outbound";
import { type AuthVariables, requireAdmin } from "../auth.js";

/**
 * /api/reload — hot-reload endpoints so Setup edits take effect without a restart.
 *
 *   POST /slack → reconnectSlack callback; returns { ok, error? } (admin)
 *   POST /auth  → reloadAuth callback; returns { ok, error? }
 *                 Unauthenticated during first boot (no auth configured yet);
 *                 once auth is running it requires an admin.
 *
 * User-visible failures (bad tokens, unreachable Slack) return HTTP 200 with
 * `{ ok: false, error }` so the console shows a toast; genuine server bugs 500.
 */
export function createReloadRoutes(
  opts: {
    reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
    reloadAuth?: () => Promise<{ ok: boolean; error?: string }>;
    isAuthConfigured?: () => boolean;
    logger?: Logger;
  } = {},
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { reconnectSlack, reloadAuth, isAuthConfigured, logger } = opts;

  app.post("/slack", requireAdmin, async (c) => {
    if (!reconnectSlack) return c.json({ ok: false, error: "slack reload not wired" }, 501);
    try {
      const result = await reconnectSlack();
      logger?.info({ ok: result.ok }, "slack reload requested");
      return c.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      logger?.error({ err: msg }, "slack reload threw");
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.post("/auth", async (c) => {
    if (!reloadAuth) return c.json({ ok: false, error: "auth reload not wired" }, 501);
    // First boot (no auth configured) is open; once auth runs, require an admin.
    if (isAuthConfigured?.()) {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      if (user.role !== "admin") return c.json({ error: "forbidden", message: "admins only" }, 403);
    }
    try {
      const result = await reloadAuth();
      logger?.info({ ok: result.ok }, "auth reload requested");
      return c.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      logger?.error({ err: msg }, "auth reload threw");
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  return app;
}
