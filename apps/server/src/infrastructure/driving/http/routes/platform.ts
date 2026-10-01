/**
 * Platform routes — the ones outside any org:
 *
 *   GET  /api/platform               → public: sign-in methods, what tino can connect for you
 *   GET  /api/me                     → the account, its memberships, orgs it may join
 *   GET  /api/orgs/slug-available    → ?slug= — for the create-org form
 *   POST /api/orgs                   → create an org; the creator is its first admin
 *   POST /api/orgs/:slug/join        → join an org whose policy admits your (verified) domain
 */
import { Hono } from "hono";
import type { CreateOrgBody, Me, OrgSummary, PlatformInfo, SlugAvailability } from "@tino/contracts";
import { joinsByDomain, readAccessPolicy } from "@tino/core/domain/access-policy";
import { type Org, orgSlugProblem, slugify } from "@tino/core/domain/org";
import { OrgSlugTakenError } from "@tino/core/domain/types";
import type { Logger } from "@tino/core/ports/outbound";
import type { Persistence } from "../../../driven/persistence/postgres/index.js";
import type { AccountVariables } from "../auth.js";

const summary = (o: Org): OrgSummary => ({ id: o.id, slug: o.slug, name: o.name });

export function createPlatformRoutes(opts: {
  persistence: Pick<Persistence, "orgs" | "memberships" | "forOrg">;
  info: () => PlatformInfo;
  /** Local dev: unverified emails may join and accept invites. */
  trustUnverified: boolean;
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

    const now = Date.now();
    let org: Org;
    try {
      org = await orgs.create({
        id: crypto.randomUUID(),
        slug,
        name,
        status: "active",
        slackTeamId: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      if (err instanceof OrgSlugTakenError) return c.json({ error: "that name is taken" }, 409);
      throw err;
    }
    const { users, identities } = persistence.forOrg(org.id);
    const admin = await users.create({
      id: crypto.randomUUID(),
      email: account.email,
      name: account.name ?? undefined,
      role: "admin",
      status: "active",
      slackUserId: null,
      createdAt: now,
      updatedAt: now,
    });
    await identities.link({ provider: "email", externalId: account.email, tinoUserId: admin.id, linkedAt: now });
    logger.info({ org: slug, by: account.id }, "org created");
    return c.json(summary(org), 201);
  });

  app.post("/orgs/:slug/join", async (c) => {
    const account = c.get("account");
    if (!account) return c.json({ error: "unauthorized" }, 401);
    if (!account.emailVerified && !opts.trustUnverified) {
      return c.json({ error: "verify_email", message: "confirm your email address first" }, 403);
    }
    const org = await orgs.getBySlug(c.req.param("slug"));
    if (!org || org.status !== "active") return c.json({ error: "not_found", message: "no such org" }, 404);
    const { users, identities, config } = persistence.forOrg(org.id);
    if (await users.getByEmail(account.email)) return c.json(summary(org));
    if (!joinsByDomain(await readAccessPolicy(config), account.email)) {
      return c.json({ error: "not_found", message: "no such org" }, 404);
    }
    const now = Date.now();
    const member = await users.create({
      id: crypto.randomUUID(),
      email: account.email,
      name: account.name ?? undefined,
      role: "member",
      status: "active",
      slackUserId: null,
      createdAt: now,
      updatedAt: now,
    });
    await identities.link({ provider: "email", externalId: account.email, tinoUserId: member.id, linkedAt: now });
    logger.info({ org: org.slug, tinoUserId: member.id }, "joined org by domain");
    return c.json(summary(org), 201);
  });

  return app;
}
