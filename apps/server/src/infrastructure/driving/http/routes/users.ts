import { Hono } from "hono";
import { ACCESS_DOMAIN_KEY, ACCESS_MODE_KEY, readAccessPolicy } from "@tino/core/domain/access-policy";
import type { TinoUser } from "@tino/core/domain/types";
import type { Logger, UserCapabilityStore } from "@tino/core/ports/outbound";
import { type AuthVariables, requireAdmin } from "../auth.js";

/**
 * /api/orgs/:slug/users — member management (admin only).
 *
 *   GET    /          → every user plus which personal connections they have
 *   POST   /          → invite { email, role } — the person activates by signing
 *                       in to the console or DMing tino in Slack
 *   PATCH  /:id       → { role?, status? } — promote/demote, suspend/reactivate
 *   GET    /access    → who may join without an invite
 *   PUT    /access    → { mode: "org-domain" | "invite-only", domain? }
 *
 * The last active admin can't be demoted or suspended — otherwise nobody could
 * reach Settings again without editing the database.
 */
export function createUserRoutes(opts: {
  logger: Logger;
  /** Tell an invited person about their invite (email). Failures don't fail the invite. */
  onInvite?: (invite: { email: string; orgName: string; orgSlug: string; invitedBy: string }) => Promise<void>;
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { logger, onInvite } = opts;

  app.use("*", requireAdmin);

  const view = async (userCapabilities: UserCapabilityStore, u: TinoUser) => {
    const caps = await userCapabilities.list(u.id).catch(() => []);
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      role: u.role,
      status: u.status,
      slackLinked: !!u.slackUserId,
      // What this person has connected for themselves (not workspace-wide).
      connections: caps
        .filter(
          (c) =>
            c.enabled &&
            (c.capabilityId === "slack" || c.capabilityId === "gmail" || c.capabilityId.startsWith("mcp.")),
        )
        .map((c) => (c.capabilityId.startsWith("mcp.") ? "mcp" : c.capabilityId))
        .filter((c, i, all) => all.indexOf(c) === i),
      createdAt: new Date(u.createdAt).toISOString(),
    };
  };

  app.get("/", async (c) => {
    const { users, userCapabilities } = c.get("org").stores;
    const all = await users.list();
    all.sort((a, b) => a.createdAt - b.createdAt);
    return c.json({ items: await Promise.all(all.map((u) => view(userCapabilities, u))) });
  });

  app.post("/", async (c) => {
    const rt = c.get("org");
    const { users, identities, userCapabilities } = rt.stores;
    let body: { email?: string; role?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const email = (body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "a valid email is required" }, 400);
    const role = body.role === "admin" ? "admin" : "member";

    if (await users.getByEmail(email)) return c.json({ error: "that person already has an account" }, 409);

    const now = Date.now();
    const user = await users.create({
      id: crypto.randomUUID(),
      email,
      role,
      status: "invited",
      slackUserId: null,
      createdAt: now,
      updatedAt: now,
    });
    // Console sign-in resolves by email identity; Slack links by profile email.
    await identities.link({ provider: "email", externalId: email, tinoUserId: user.id, linkedAt: now });
    logger.info({ by: c.get("user").id, tinoUserId: user.id, role }, "user invited");
    await onInvite?.({ email, orgName: rt.org.name, orgSlug: rt.org.slug, invitedBy: c.get("user").email }).catch((err: Error) =>
      logger.warn({ err: err.message }, "invite email failed"),
    );
    return c.json(await view(userCapabilities, user), 201);
  });

  app.patch("/:id", async (c) => {
    const { users, userCapabilities } = c.get("org").stores;
    const id = c.req.param("id");
    let body: { role?: string; status?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const target = await users.get(id);
    if (!target) return c.json({ error: "no such user" }, 404);

    const patch: { role?: "admin" | "member"; status?: "active" | "suspended" } = {};
    if (body.role !== undefined) {
      if (body.role !== "admin" && body.role !== "member")
        return c.json({ error: "role must be admin or member" }, 400);
      patch.role = body.role;
    }
    if (body.status !== undefined) {
      if (body.status !== "active" && body.status !== "suspended") {
        return c.json({ error: "status must be active or suspended" }, 400);
      }
      patch.status = body.status;
    }

    const losesAdmin =
      target.role === "admin" &&
      target.status === "active" &&
      (patch.role === "member" || patch.status === "suspended");
    if (losesAdmin) {
      const activeAdmins = (await users.list()).filter((u) => u.role === "admin" && u.status === "active");
      if (activeAdmins.length <= 1) return c.json({ error: "tino needs at least one active admin" }, 409);
    }

    const updated = await users.update(id, patch);
    logger.info({ by: c.get("user").id, tinoUserId: id, ...patch }, "user updated");
    return c.json(await view(userCapabilities, updated));
  });

  app.get("/access", async (c) => c.json(await readAccessPolicy(c.get("org").stores.config)));

  app.put("/access", async (c) => {
    const { config } = c.get("org").stores;
    let body: { mode?: string; domain?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    if (body.mode === "invite-only") {
      await config.set(ACCESS_MODE_KEY, "allowlist");
    } else if (body.mode === "org-domain") {
      const domain = (body.domain ?? "").trim().toLowerCase().replace(/^@/, "");
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return c.json({ error: "a valid domain is required" }, 400);
      await config.set(ACCESS_MODE_KEY, "org-domain");
      await config.set(ACCESS_DOMAIN_KEY, domain);
    } else {
      return c.json({ error: "mode must be org-domain or invite-only" }, 400);
    }
    logger.info({ by: c.get("user").id, mode: body.mode }, "access policy updated");
    return c.json(await readAccessPolicy(config));
  });

  return app;
}
