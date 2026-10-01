import type { ManagedUser } from "@tino/contracts";
import { ACCESS_DOMAIN_KEY, ACCESS_MODE_KEY, readAccessPolicy } from "@tino/core/domain/access-policy";
import type { TinoUser } from "@tino/core/domain/types";
import type { Logger, PendingInvitation, UserCapabilityStore } from "@tino/core/ports/outbound";
import { Hono } from "hono";
import { type AuthVariables, authorize, permit } from "../auth.js";
import { type OrgAdmin, OrgAdminError } from "../org-admin.js";

/**
 * /api/orgs/:slug/users — the people in an org.
 *
 *   GET    /          → members and pending invitations. Members see a directory
 *                       (names, roles); admins also see connections and dates.
 *   POST   /          → invite { email, role } (admins) — better-auth's org plugin
 *                       records it and emails the link; the person joins by signing
 *                       up with that address, or by DMing tino from it in Slack
 *   PATCH  /:id       → { role?, status? } — promote/demote, suspend/reactivate (admins)
 *   DELETE /:id       → cancel a pending invitation (admins)
 *   GET    /access    → who may join without an invite (admins)
 *   PUT    /access    → { mode: "org-domain" | "invite-only", domain? } (admins)
 *
 * The last active admin can't be demoted or suspended — otherwise nobody could
 * reach Settings again without editing the database.
 */
export function createUserRoutes(opts: { logger: Logger; orgAdmin: OrgAdmin }): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { logger, orgAdmin } = opts;

  const memberView = async (caps: UserCapabilityStore, u: TinoUser): Promise<ManagedUser> => {
    const rows = await caps.list(u.id).catch(() => []);
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      role: u.role,
      status: u.status,
      slackLinked: !!u.slackUserId,
      // What this person has connected for themselves (not workspace-wide).
      connections: rows
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

  const inviteView = (i: PendingInvitation): ManagedUser => ({
    id: i.id,
    email: i.email,
    name: null,
    role: i.role,
    status: "invited",
    slackLinked: false,
    connections: [],
    createdAt: new Date(i.expiresAt).toISOString(),
  });

  const refused = (err: unknown) => {
    if (err instanceof OrgAdminError) return { status: err.status, body: { error: err.message } };
    throw err;
  };

  app.get("/", authorize("read", "member"), async (c) => {
    const { users, userCapabilities, invitations } = c.get("org").stores;
    const members = (await users.list()).sort((a, b) => a.createdAt - b.createdAt);
    const directory = permit(c, "read", "member");
    const items: Array<Partial<ManagedUser>> = [];
    for (const m of members) items.push(directory.filter(await memberView(userCapabilities, m)));
    if (permit(c, "read", "invitation").granted) {
      for (const i of await invitations.list()) items.push(inviteView(i));
    }
    return c.json({ items });
  });

  app.post("/", authorize("create", "invitation"), async (c) => {
    const rt = c.get("org");
    let body: { email?: string; role?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const email = (body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "a valid email is required" }, 400);
    const role = body.role === "admin" ? "admin" : "member";
    if (await rt.stores.users.getByEmail(email)) return c.json({ error: "that person is already a member" }, 409);

    try {
      await orgAdmin.invite(c.req.raw.headers, { orgId: rt.org.id, email, role });
    } catch (err) {
      const r = refused(err);
      return c.json(r.body, r.status);
    }
    const invite = await rt.stores.invitations.pendingFor(email);
    logger.info({ by: c.get("user").id, invitation: invite?.id, role }, "member invited");
    return c.json(invite ? inviteView(invite) : { email, role, status: "invited" }, 201);
  });

  app.patch("/:id", authorize("update", "member"), async (c) => {
    const rt = c.get("org");
    const { users, userCapabilities } = rt.stores;
    const id = c.req.param("id");
    let body: { role?: string; status?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const target = await users.get(id);
    if (!target) {
      const pending = (await rt.stores.invitations.list()).some((i) => i.id === id);
      return pending
        ? c.json({ error: "that invitation hasn't been accepted yet — cancel it and invite again" }, 409)
        : c.json({ error: "no such member" }, 404);
    }
    if (body.role !== undefined && body.role !== "admin" && body.role !== "member") {
      return c.json({ error: "role must be admin or member" }, 400);
    }
    if (body.status !== undefined && body.status !== "active" && body.status !== "suspended") {
      return c.json({ error: "status must be active or suspended" }, 400);
    }
    const role = body.role as "admin" | "member" | undefined;
    const status = body.status as "active" | "suspended" | undefined;

    const losesAdmin =
      target.role === "admin" && target.status === "active" && (role === "member" || status === "suspended");
    if (losesAdmin) {
      const activeAdmins = (await users.list()).filter((u) => u.role === "admin" && u.status === "active");
      if (activeAdmins.length <= 1) return c.json({ error: "tino needs at least one active admin" }, 409);
    }

    try {
      if (role && role !== target.role) {
        await orgAdmin.updateRole(c.req.raw.headers, { orgId: rt.org.id, memberId: id, role });
      }
    } catch (err) {
      const r = refused(err);
      return c.json(r.body, r.status);
    }
    const updated = status ? await users.update(id, { status }) : ((await users.get(id)) as TinoUser);
    logger.info({ by: c.get("user").id, tinoUserId: id, role, status }, "member updated");
    return c.json(await memberView(userCapabilities, updated));
  });

  app.delete("/:id", authorize("delete", "invitation"), async (c) => {
    const rt = c.get("org");
    const id = c.req.param("id");
    if (!(await rt.stores.invitations.list()).some((i) => i.id === id)) {
      return c.json({ error: "no such pending invitation" }, 404);
    }
    try {
      await orgAdmin.cancelInvitation(c.req.raw.headers, id);
    } catch (err) {
      const r = refused(err);
      return c.json(r.body, r.status);
    }
    logger.info({ by: c.get("user").id, invitation: id }, "invitation cancelled");
    return c.json({ ok: true });
  });

  app.get("/access", authorize("read", "accessPolicy"), async (c) =>
    c.json(await readAccessPolicy(c.get("org").stores.config)),
  );

  app.put("/access", authorize("update", "accessPolicy"), async (c) => {
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
