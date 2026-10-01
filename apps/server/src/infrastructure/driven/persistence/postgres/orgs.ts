/**
 * The platform-wide reads and writes: the org registry, and the cross-org
 * membership lookups sign-in needs. Everything else is bound to one org.
 */
import { joinsByDomain, readAccessPolicy } from "@tino/core/domain/access-policy";
import type { Org } from "@tino/core/domain/org";
import { OrgSlugTakenError } from "@tino/core/domain/types";
import type { ConfigStore, Membership, MembershipDirectory, OrgStore } from "@tino/core/ports/outbound";
import type { PgPool } from "../db.js";
import { rowToUser, type UserRow } from "./users.js";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  slack_team_id: string | null;
  created_at: string;
  updated_at: string;
}

const rowToOrg = (r: OrgRow): Org => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  status: r.status as Org["status"],
  slackTeamId: r.slack_team_id,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

export function createPgOrgStore({ pool }: { pool: PgPool }): OrgStore {
  const one = async (sql: string, params: unknown[]): Promise<Org | null> => {
    const res = await pool.query<OrgRow>(sql, params);
    return res.rows[0] ? rowToOrg(res.rows[0]) : null;
  };
  return {
    async create(org) {
      try {
        await pool.query(
          `INSERT INTO org (id, slug, name, status, slack_team_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [org.id, org.slug, org.name, org.status, org.slackTeamId, org.createdAt, org.updatedAt],
        );
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new OrgSlugTakenError(org.slug);
        throw err;
      }
      return org;
    },
    get: (id) => one("SELECT * FROM org WHERE id = $1", [id]),
    getBySlug: (slug) => one("SELECT * FROM org WHERE slug = $1", [slug.toLowerCase()]),
    getBySlackTeam: (teamId) => one("SELECT * FROM org WHERE slack_team_id = $1", [teamId]),
    async list() {
      const res = await pool.query<OrgRow>("SELECT * FROM org ORDER BY created_at ASC");
      return res.rows.map(rowToOrg);
    },
    async update(id, patch) {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (patch.name !== undefined) values.push(patch.name) && sets.push(`name = $${values.length}`);
      if (patch.status !== undefined) values.push(patch.status) && sets.push(`status = $${values.length}`);
      if (patch.slackTeamId !== undefined)
        values.push(patch.slackTeamId) && sets.push(`slack_team_id = $${values.length}`);
      values.push(Date.now());
      sets.push(`updated_at = $${values.length}`);
      values.push(id);
      const res = await pool.query<OrgRow>(
        `UPDATE org SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
        values,
      );
      if (!res.rows[0]) throw new Error(`org not found: ${id}`);
      return rowToOrg(res.rows[0]);
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
      const res = await pool.query<UserRow & { o: OrgRow }>(
        `SELECT u.*, row_to_json(o.*) AS o
         FROM tino_user u JOIN org o ON o.id = u.org_id
         WHERE lower(u.email) = lower($1)
         ORDER BY u.created_at ASC`,
        [email],
      );
      return res.rows.map((r): Membership => ({ org: rowToOrg(r.o), user: rowToUser(r) }));
    },

    async joinableByDomain(email) {
      const domain = email.toLowerCase().split("@")[1];
      if (!domain) return [];
      // Candidate orgs name this domain in their policy; the policy reader then
      // decides exactly as every other join path does.
      const res = await pool.query<OrgRow>(
        `SELECT o.* FROM org o
         JOIN org_config c ON c.org_id = o.id AND c.key = 'org.accessControl.orgDomain' AND c.value = $1
         WHERE o.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM tino_user u WHERE u.org_id = o.id AND lower(u.email) = lower($2))`,
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
