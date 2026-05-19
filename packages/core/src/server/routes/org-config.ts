import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { IdentityStore, UserStore } from "../../identity/store.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";

export interface OrgConfigRoutesOpts {
  config: ConfigStore;
  users: UserStore;
  identities: IdentityStore;
  logger: AppLogger;
  auditLogger?: AuditLogger;
}

export function createOrgConfigRoutes(opts: OrgConfigRoutesOpts): Hono<{ Variables: AuthVariables }> {
  const { config, users, identities, logger, auditLogger } = opts;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("*", requireAdmin());

  app.get("/access-control", async (c) => {
    const rawMode = await config.get("org.accessControl.mode");
    const rawDomain = await config.get("org.accessControl.orgDomain");

    const mode = rawMode ? (JSON.parse(rawMode) as string) : "allowlist";
    const orgDomain = rawDomain ? (JSON.parse(rawDomain) as string) : undefined;

    return c.json({ mode, orgDomain });
  });

  app.put("/access-control", async (c) => {
    const body = await c.req.json<{ mode: string; orgDomain?: string }>();

    if (!body.mode || !["allowlist", "org-domain"].includes(body.mode)) {
      return c.json({ error: "invalid mode — must be 'allowlist' or 'org-domain'" }, 400);
    }
    if (body.mode === "org-domain" && !body.orgDomain) {
      return c.json({ error: "orgDomain is required when mode is 'org-domain'" }, 400);
    }

    await config.set("org.accessControl.mode", JSON.stringify(body.mode));
    if (body.orgDomain !== undefined) {
      await config.set("org.accessControl.orgDomain", JSON.stringify(body.orgDomain));
    }

    const user = c.get("user");
    if (auditLogger) {
      await auditLogger.log({
        userId: user.id,
        action: "config_change",
        toolName: "org.accessControl",
        status: "success",
      });
    }

    logger.info({ mode: body.mode, orgDomain: body.orgDomain, by: user.id }, "access control updated");
    return c.json({ ok: true, mode: body.mode, orgDomain: body.orgDomain });
  });

  app.post("/users", async (c) => {
    const body = await c.req.json<{ email: string; slackUserId?: string; role?: string }>();

    if (!body.email) {
      return c.json({ error: "email is required" }, 400);
    }

    const email = body.email.toLowerCase();
    const existing = await users.getByEmail(email);
    if (existing) {
      return c.json({ error: "user with this email already exists", userId: existing.id }, 409);
    }

    const newUser = await users.create({
      id: crypto.randomUUID(),
      email,
      role: (body.role as "admin" | "member") ?? "member",
      status: "invited",
      slackUserId: body.slackUserId ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    if (body.slackUserId) {
      await identities.link({
        provider: "slack",
        externalId: body.slackUserId,
        tinoUserId: newUser.id,
        linkedAt: Date.now(),
      });
    }

    const adminUser = c.get("user");
    if (auditLogger) {
      await auditLogger.log({
        userId: adminUser.id,
        action: "config_change",
        toolName: `user:${newUser.id}`,
        status: "success",
      });
    }

    logger.info({ newUserId: newUser.id, email, by: adminUser.id }, "user added by admin");
    return c.json({ ok: true, user: newUser }, 201);
  });

  app.patch("/users/:id/status", async (c) => {
    const targetId = decodeURIComponent(c.req.param("id"));
    const body = await c.req.json<{ status: string }>();

    if (!body.status || !["active", "suspended"].includes(body.status)) {
      return c.json({ error: "status must be 'active' or 'suspended'" }, 400);
    }

    const target = await users.get(targetId);
    if (!target) {
      return c.json({ error: "user not found" }, 404);
    }

    const updated = await users.update(targetId, { status: body.status as "active" | "suspended" });

    const adminUser = c.get("user");
    if (auditLogger) {
      await auditLogger.log({
        userId: adminUser.id,
        action: "config_change",
        toolName: `user:${targetId}:status`,
        status: "success",
      });
    }

    logger.info({ targetId, newStatus: body.status, by: adminUser.id }, "user status changed by admin");
    return c.json({ ok: true, user: updated });
  });

  return app;
}
