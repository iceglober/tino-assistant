/**
 * Platform routes — the ones outside any org:
 *
 *   GET  /api/platform               → public: sign-in methods, what tino can connect for you
 *   GET  /api/me                     → the account, its memberships, orgs it may join
 *   GET  /api/orgs/slug-available    → ?slug= — for the create-org form
 *   POST /api/orgs                   → create an org (better-auth's org plugin); the creator owns it
 *   POST /api/orgs/:slug/join        → join an org whose policy admits your (verified) domain
 */

import type { CreateOrgBody, Me, OrgSummary, PlatformInfo, SlugAvailability } from "@tino/contracts";
import { joinsByDomain, readAccessPolicy } from "@tino/core/domain/access-policy";
import { type Org, orgSlugProblem, slugify } from "@tino/core/domain/org";
import type { Logger } from "@tino/core/ports/outbound";
import { Hono } from "hono";
import type { Persistence } from "../../../driven/persistence/postgres/index.js";
import type { AccountVariables } from "../auth.js";
import { type OrgAdmin, OrgAdminError } from "../org-admin.js";

const summary = (o: Org): OrgSummary => ({ id: o.id, slug: o.slug, name: o.name });

export function createPlatformRoutes(opts: {
  persistence: Pick<Persistence, "orgs" | "memberships" | "forOrg">;
  info: () => PlatformInfo;
  /** Local dev: unverified emails may join and accept invites. */
  trustUnverified: boolean;
  /** Closed beta: only some addresses may create orgs. */
  canCreateOrg: (email: string) => boolean;
  orgAdmin: OrgAdmin;
  logger: Logger;
}): Hono<{ Variables: AccountVariables }> {
  const app = new Hono<{ Variables: AccountVariables }>();
  const { persistence, logger } = opts;
  const { orgs, memberships } = persistence;

  app.get("/platform", (c) => c.json(opts.info()));

  app.get("/me", async (c) => {
    const account = c.get("account");
    if (!account) return c.json({ error: "unauthorized" }, 401);
    const [mine, joinable] = await Promise.all([
      memberships.byEmail(account.email),
      memberships.joinableByDomain(account.email),
    ]);
    const body: Me = {
      account,
      memberships: mine
        .filter((m) => m.org.status === "active")
        .map((m) => ({ org: summary(m.org), role: m.user.role, status: m.user.status })),
      joinable: joinable.map(summary),
      canCreateOrg: opts.canCreateOrg(account.email),
    };
    return c.json(body);
  });

  async function availability(slug: string): Promise<SlugAvailability> {
    const problem = orgSlugProblem(slug);
    if (problem) return { slug, available: false, problem };
    const taken = await orgs.getBySlug(slug);
    return taken ? { slug, available: false, problem: "that name is taken" } : { slug, available: true };
  }

  app.get("/orgs/slug-available", async (c) => {
    if (!c.get("account")) return c.json({ error: "unauthorized" }, 401);
    return c.json(await availability((c.req.query("slug") ?? "").trim().toLowerCase()));
  });

  app.post("/orgs", async (c) => {
    const account = c.get("account");
    if (!account) return c.json({ error: "unauthorized" }, 401);
    if (!account.emailVerified && !opts.trustUnverified) {
      return c.json({ error: "verify_email", message: "confirm your email address first" }, 403);
    }
    if (!opts.canCreateOrg(account.email)) {
      return c.json(
        { error: "closed_beta", message: "Tino is in private beta — ask for an invite to an existing org." },
        403,
      );
    }
    let body: CreateOrgBody;
    try {
      body = (await c.req.json()) as CreateOrgBody;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const name = (body.name ?? "").trim();
    if (name.length < 2 || name.length > 80) return c.json({ error: "give your org a name (2–80 characters)" }, 400);
    const slug = (body.slug ?? slugify(name)).trim().toLowerCase();
    const check = await availability(slug);
    if (!check.available) return c.json({ error: check.problem ?? "that name is taken" }, 409);

    try {
      const org = await opts.orgAdmin.createOrg({ name, slug, userId: account.id });
      logger.info({ org: org.slug, by: account.id }, "org created");
      return c.json({ id: org.id, slug: org.slug, name: org.name }, 201);
    } catch (err) {
      if (err instanceof OrgAdminError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  app.post("/orgs/:slug/join", async (c) => {
    const account = c.get("account");
    if (!account) return c.json({ error: "unauthorized" }, 401);
    if (!account.emailVerified && !opts.trustUnverified) {
      return c.json({ error: "verify_email", message: "confirm your email address first" }, 403);
    }
    const org = await orgs.getBySlug(c.req.param("slug"));
    if (!org || org.status !== "active") return c.json({ error: "not_found", message: "no such org" }, 404);
    const { users, config } = persistence.forOrg(org.id);
    if (await users.getByEmail(account.email)) return c.json(summary(org));
    if (!joinsByDomain(await readAccessPolicy(config), account.email)) {
      return c.json({ error: "not_found", message: "no such org" }, 404);
    }
    try {
      await opts.orgAdmin.addMember({ orgId: org.id, userId: account.id, role: "member" });
    } catch (err) {
      if (err instanceof OrgAdminError) return c.json({ error: err.message }, err.status);
      throw err;
    }
    logger.info({ org: org.slug, account: account.id }, "joined org by domain");
    return c.json(summary(org), 201);
  });

  return app;
}
