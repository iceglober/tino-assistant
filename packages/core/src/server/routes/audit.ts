import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

export interface AuditRoutesOpts {
  auditLogger: AuditLogger;
  logger: AppLogger;
}

export function createAuditRoutes(opts: AuditRoutesOpts): Hono<{ Variables: AuthVariables }> {
  const { auditLogger } = opts;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const user = c.get("user");
    const isAdmin = user.role === "admin";

    const queryUserId = c.req.query("userId");
    const action = c.req.query("action");
    const since = c.req.query("since");
    const limitStr = c.req.query("limit");

    const effectiveUserId = isAdmin ? queryUserId : user.id;

    const entries = await auditLogger.query({
      userId: effectiveUserId ?? undefined,
      action: action ?? undefined,
      since: since ? Number(since) : undefined,
      limit: limitStr ? Number(limitStr) : 100,
    });

    return c.json({ entries });
  });

  return app;
}
