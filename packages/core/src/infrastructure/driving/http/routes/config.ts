import { Hono } from "hono";
import type { ConfigStore } from "../../../../ports/outbound.js";
import type { Logger } from "../../../../ports/outbound.js";
import { type AuthVariables, requireAdmin } from "../auth.js";

/**
 * /api/config — list, set, delete config entries (Slack/Azure/Google keys).
 * Admin-only: these entries include every deployment secret (Slack tokens,
 * model keys, the Google OAuth client). Members read what they need from
 * /api/status instead.
 */
export function createConfigRoutes(opts: {
  config: ConfigStore;
  logger: Logger;
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { config, logger } = opts;

  app.use("*", requireAdmin);

  app.get("/", async (c) => {
    const entries = await config.list();
    return c.json(entries);
  });

  app.put("/:key", async (c) => {
    const key = decodeURIComponent(c.req.param("key"));
    if (!key) return c.json({ error: "Missing key" }, 400);

    let parsed: { value: unknown };
    try {
      parsed = (await c.req.json()) as { value: unknown };
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    if (!("value" in parsed)) {
      return c.json({ error: 'Request body must have a "value" field' }, 400);
    }

    await config.set(key, parsed.value);
    logger.info({ key }, "config updated via console");
    return c.json({ ok: true, key });
  });

  app.delete("/:key", async (c) => {
    const key = decodeURIComponent(c.req.param("key"));
    if (!key) return c.json({ error: "Missing key" }, 400);

    const deleted = await config.delete(key);
    if (deleted) logger.info({ key }, "config entry deleted via console");
    return c.json({ ok: true, deleted });
  });

  return app;
}
