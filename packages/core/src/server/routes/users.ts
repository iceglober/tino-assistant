import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { AppLogger } from "../../slack/app.js";

/**
 * /api/users — admin user-management endpoints.
 *
 * Mirror: DELETE /api/users/:userId at console/server.ts:287-322.
 *
 * Deprovisioning sequence:
 *   1. Set `user.<id>.status` to "deactivated"
 *   2. Delete every `user.<id>.capability.*` token entry
 *   3. Audit-log the action
 */
export function createUsersRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
  auditLogger: AuditLogger | undefined;
}): Hono {
  const app = new Hono();
  const { config, logger, auditLogger } = opts;

  app.delete("/:userId", async (c) => {
    const targetUserId = decodeURIComponent(c.req.param("userId"));
    if (!targetUserId) return c.json({ error: "Missing userId" }, 400);

    // 1. Set user status to deactivated
    await config.set(`user.${targetUserId}.status`, "deactivated");

    // 2. Delete personal capability tokens
    const entries = await config.list();
    const personalCapKeys = entries
      .filter((e) => e.key.startsWith(`user.${targetUserId}.capability.`))
      .map((e) => e.key);
    for (const capKey of personalCapKeys) {
      await config.delete(capKey);
    }

    // 3. Audit
    if (auditLogger) {
      await auditLogger.log({
        userId: "console",
        action: "user_deprovisioned",
        toolName: targetUserId,
        status: "success",
      });
    }

    logger.info({ targetUserId }, "user deprovisioned via console");
    return c.json({ ok: true, userId: targetUserId, status: "deactivated" });
  });

  return app;
}
