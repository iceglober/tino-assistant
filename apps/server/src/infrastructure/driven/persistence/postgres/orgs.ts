/**
 * The platform-wide reads: the org registry and the cross-org membership
 * lookups sign-in needs, over better-auth's organization plugin tables. Orgs
 * are created through the plugin (routes/platform.ts); `create` here exists for
 * seeding and tests.
 */
import { joinsByDomain, readAccessPolicy } from "@tino/core/domain/access-policy";
import type { Org } from "@tino/core/domain/org";
import { OrgSlugTakenError, type TinoUser } from "@tino/core/domain/types";
import type {
  ConfigStore,
  InvitationStore,
  Membership,
  MembershipDirectory,
  OrgStore,
  PendingInvitation,
} from "@tino/core/ports/outbound";
import type { PgPool } from "../db.js";
import { ensureAccount, MEMBER_SELECT, rowToUser, type UserRow } from "./users.js";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: string | null;
  slackTeamId: string | null;
  createdAt: Date | string;
}

const ORG_SELECT = `SELECT id, slug, name, status, "slackTeamId", "createdAt" FROM organization`;

export const rowToOrg = (r: OrgRow): Org => {
  const created = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status === "suspended" ? "suspended" : "active",
    slackTeamId: r.slackTeamId,
    createdAt: created,
    updatedAt: created,
  };
};

export function createPgOrgStore({ pool }: { pool: PgPool }): OrgStore {
  const one = async (where: string, params: unknown[]): Promise<Org | null> => {
    const res = await pool.query<OrgRow>(`${ORG_SELECT} WHERE ${where}`, params);
    return res.rows[0] ? rowToOrg(res.rows[0]) : null;
  };
  return {
    async create(org) {
      if (await one("slug = $1", [org.slug])) throw new OrgSlugTakenError(org.slug);
      await pool.query(
        `INSERT INTO organization (id, slug, name, status, "slackTeamId", "createdAt") VALUES ($1,$2,$3,$4,$5,$6)`,
        [org.id, org.slug, org.name, org.status, org.slackTeamId, new Date(org.createdAt)],
      );
      return org;
    },
    get: (id) => one("id = $1", [id]),
    getBySlug: (slug) => one("slug = $1", [slug.toLowerCase()]),
    getBySlackTeam: (teamId) => one(`"slackTeamId" = $1`, [teamId]),
    async list() {
      const res = await pool.query<OrgRow>(`${ORG_SELECT} ORDER BY "createdAt" ASC`);
      return res.rows.map(rowToOrg);
    },
    async update(id, patch) {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (patch.name !== undefined) values.push(patch.name) && sets.push(`name = $${values.length}`);
      if (patch.status !== undefined) values.push(patch.status) && sets.push(`status = $${values.length}`);
      if (patch.slackTeamId !== undefined)
        values.push(patch.slackTeamId) && sets.push(`"slackTeamId" = $${values.length}`);
      if (sets.length > 0) {
        values.push(id);
        await pool.query(`UPDATE organization SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      }
      const org = await one("id = $1", [id]);
      if (!org) throw new Error(`org not found: ${id}`);
      return org;
    },
  };
}

interface InvitationRow {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date | string;
  inviterId: string | null;
}

const toInvitation = (r: InvitationRow): PendingInvitation => ({
  id: r.id,
  email: r.email.toLowerCase(),
  role: r.role === "admin" || r.role === "owner" ? "admin" : "member",
  expiresAt: new Date(r.expiresAt).getTime(),
  invitedBy: r.inviterId,
});

const PENDING = `status = 'pending' AND "expiresAt" > now()`;

/** One org's open invitations (created and accepted on the web through the org plugin). */
export function createPgInvitationStore({ pool, orgId }: { pool: PgPool; orgId: string }): InvitationStore {
  const pendingFor = async (email: string): Promise<PendingInvitation | null> => {
    const res = await pool.query<InvitationRow>(
      `SELECT * FROM invitation WHERE "organizationId" = $1 AND lower(email) = lower($2) AND ${PENDING}
       ORDER BY "createdAt" DESC LIMIT 1`,
      [orgId, email],
    );
    return res.rows[0] ? toInvitation(res.rows[0]) : null;
  };

  return {
    async list() {
      const res = await pool.query<InvitationRow>(
        `SELECT * FROM invitation WHERE "organizationId" = $1 AND ${PENDING} ORDER BY "createdAt" ASC`,
        [orgId],
      );
      return res.rows.map(toInvitation);
    },

    pendingFor,

    async claim(email, name) {
      const invite = await pendingFor(email);
      if (!invite) return null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const userId = await ensureAccount(client, email, name);
        const memberId = crypto.randomUUID();
        await client.query(
          `INSERT INTO member (id, "organizationId", "userId", role, "createdAt", status) VALUES ($1,$2,$3,$4,now(),'active')
           ON CONFLICT ("organizationId", "userId") DO NOTHING`,
          [memberId, orgId, userId, invite.role],
        );
        await client.query(`UPDATE invitation SET status = 'accepted' WHERE id = $1`, [invite.id]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const res = await pool.query<UserRow>(
        `${MEMBER_SELECT} WHERE m."organizationId" = $1 AND lower(u.email) = lower($2)`,
        [orgId, email],
      );
      return res.rows[0] ? rowToUser(res.rows[0]) : null;
    },
  };
}

export function createPgMembershipDirectory({
  pool,
  configFor,
}: {
  pool: PgPool;
  /** The org's config store — the join policy lives there. */
  configFor: (orgId: string) => ConfigStore;
}): MembershipDirectory {
  return {
    async byEmail(email) {
      const [members, invites] = await Promise.all([
        pool.query<UserRow & { o: OrgRow }>(
          `SELECT x.*, row_to_json(o.*) AS o FROM (${MEMBER_SELECT} WHERE lower(u.email) = lower($1)) x
           JOIN organization o ON o.id = x.org_id ORDER BY x.created_at ASC`,
          [email],
        ),
        pool.query<InvitationRow & { o: OrgRow; created: Date }>(
          `SELECT i.*, row_to_json(o.*) AS o FROM invitation i JOIN organization o ON o.id = i."organizationId"
           WHERE lower(i.email) = lower($1) AND i.status = 'pending' AND i."expiresAt" > now()
             AND NOT EXISTS (SELECT 1 FROM member m JOIN "user" u ON u.id = m."userId"
                             WHERE m."organizationId" = i."organizationId" AND lower(u.email) = lower($1))`,
          [email],
        ),
      ]);
      const out: Membership[] = members.rows.map((r) => ({ org: rowToOrg(r.o), user: rowToUser(r) }));
      for (const r of invites.rows) {
        const invited: TinoUser = {
          id: r.id,
          email: r.email.toLowerCase(),
          role: r.role === "admin" || r.role === "owner" ? "admin" : "member",
          status: "invited",
          slackUserId: null,
          createdAt: new Date(r.expiresAt).getTime(),
          updatedAt: new Date(r.expiresAt).getTime(),
        };
        out.push({ org: rowToOrg(r.o), user: invited });
      }
      return out;
    },

    async joinableByDomain(email) {
      const domain = email.toLowerCase().split("@")[1];
      if (!domain) return [];
      // Candidate orgs name this domain in their policy; the policy reader then
      // decides exactly as every other join path does.
      const res = await pool.query<OrgRow>(
        `SELECT o.id, o.slug, o.name, o.status, o."slackTeamId", o."createdAt" FROM organization o
         JOIN org_config c ON c.org_id = o.id AND c.key = 'org.accessControl.orgDomain' AND c.value = $1
         WHERE coalesce(o.status, 'active') = 'active'
           AND NOT EXISTS (SELECT 1 FROM member m JOIN "user" u ON u.id = m."userId"
                           WHERE m."organizationId" = o.id AND lower(u.email) = lower($2))`,
        [JSON.stringify(domain), email],
      );
      const out: Org[] = [];
      for (const row of res.rows) {
        const policy = await readAccessPolicy(configFor(row.id));
        if (joinsByDomain(policy, email)) out.push(rowToOrg(row));
      }
      return out;
    },
  };
}
