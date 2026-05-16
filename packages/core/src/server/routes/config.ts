import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { AppLogger } from "../../slack/app.js";

/**
 * /api/config — list, set, delete config entries.
 *
 * Mirror:
 *   GET    /api/config       → console/server.ts:102-108
 *   PUT    /api/config/:key  → console/server.ts:111-152
 *   DELETE /api/config/:key  → console/server.ts:155-178
 *
 * Every write goes through `auditLogger.log({ userId, action, toolName, status })`
 * — preserve the shape from server.ts:139-146.
 */
export function createConfigRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
  auditLogger: AuditLogger | undefined;
}): Hono {
  const app = new Hono();
  const { config, logger, auditLogger } = opts;

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
    if (auditLogger) {
      await auditLogger.log({
        userId: "console",
        action: "config_change",
        toolName: key,
        status: "success",
      });
    }
    return c.json({ ok: true, key });
  });

  app.delete("/:key", async (c) => {
    const key = decodeURIComponent(c.req.param("key"));
    if (!key) return c.json({ error: "Missing key" }, 400);

    const deleted = await config.delete(key);
    if (deleted) {
      logger.info({ key }, "config entry deleted via console");
      if (auditLogger) {
        await auditLogger.log({
          userId: "console",
          action: "config_change",
          toolName: key,
          status: "success",
        });
      }
    }
    return c.json({ ok: true, deleted });
  });

  return app;
}
