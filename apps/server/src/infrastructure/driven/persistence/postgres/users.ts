/**
 * Org-bound UserStore + IdentityStore over better-auth's tables.
 *
 * A tino user is a `member` of the org (its id is the member id) joined to the
 * platform `user` for email and name. Every person in an org has an account:
 * someone who only ever talks to tino in Slack gets one without a password,
 * which they can claim later with a magic link or a password reset.
 *
 * Roles: the plugin's `owner` and `admin` are both `admin` to the domain;
 * `orgRole` carries the exact one for permission checks.
 */
import {
  type Identity,
  IdentityLinkConflictError,
  type IdentityProvider,
  type TinoUser,
} from "@tino/core/domain/types";
import type { IdentityStore, UserStore } from "@tino/core/ports/outbound";
import type { PgPool } from "../db.js";

export interface UserRow {
  id: string;
  org_id: string;
  role: string;
  status: string | null;
  slack_user_id: string | null;
  created_at: Date | string;
  email: string;
  name: string | null;
  updated_at: Date | string;
}

const ms = (v: Date | string | number): number => (v instanceof Date ? v.getTime() : new Date(v).getTime());

export function rowToUser(row: UserRow): TinoUser {
  const orgRole = row.role === "owner" || row.role === "admin" ? row.role : "member";
  return {
    id: row.id,
    email: row.email.toLowerCase(),
    name: row.name || undefined,
    role: orgRole === "member" ? "member" : "admin",
    orgRole,
    status: (row.status ?? "active") as TinoUser["status"],
    slackUserId: row.slack_user_id,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

/** Members of every org, with their account's email and name. Filter it with WHERE. */
export const MEMBER_SELECT = `
  SELECT m.id, m."organizationId" AS org_id, m.role, m.status, m."slackUserId" AS slack_user_id,
         m."createdAt" AS created_at, u.email, u.name, u."updatedAt" AS updated_at
  FROM member m JOIN "user" u ON u.id = m."userId"`;

/** The account for an email, created without credentials if it doesn't exist yet. */
export async function ensureAccount(
  q: Pick<PgPool, "query">,
  email: string,
  name: string | undefined,
): Promise<string> {
  const found = await q.query<{ id: string }>(`SELECT id FROM "user" WHERE lower(email) = lower($1)`, [email]);
  if (found.rows[0]) return found.rows[0].id;
  const id = crypto.randomUUID();
  const now = new Date();
  await q.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,false,$4,$4)`,
    [id, name ?? "", email.toLowerCase(), now],
  );
  return id;
}

export function createPgUserStore({ pool, orgId }: { pool: PgPool; orgId: string }): UserStore {
  const one = async (where: string, params: unknown[]): Promise<TinoUser | null> => {
    const res = await pool.query<UserRow>(`${MEMBER_SELECT} WHERE m."organizationId" = $1 AND ${where}`, [
      orgId,
      ...params,
    ]);
    return res.rows[0] ? rowToUser(res.rows[0]) : null;
  };

  return {
    async create(user: TinoUser): Promise<TinoUser> {
      const userId = await ensureAccount(pool, user.email, user.name);
      await pool.query(
        `INSERT INTO member (id, "organizationId", "userId", role, "createdAt", status, "slackUserId")
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [user.id, orgId, userId, user.orgRole ?? user.role, new Date(user.createdAt), user.status, user.slackUserId],
      );
      return (await one("m.id = $2", [user.id])) as TinoUser;
    },

    get: (id) => one("m.id = $2", [id]),
    getByEmail: (email) => one("lower(u.email) = lower($2)", [email]),

    async list(): Promise<TinoUser[]> {
      const res = await pool.query<UserRow>(
        `${MEMBER_SELECT} WHERE m."organizationId" = $1 ORDER BY m."createdAt" ASC`,
        [orgId],
      );
      return res.rows.map(rowToUser);
    },

    async update(id, patch): Promise<TinoUser> {
      const current = await one("m.id = $2", [id]);
      if (!current) throw new Error(`member not found: ${id}`);
      const sets: string[] = [];
      const values: unknown[] = [];
      // An owner stays an owner when made "admin"; demoting goes through the plugin's own checks.
      if (patch.role !== undefined && !(patch.role === "admin" && current.orgRole === "owner")) {
        values.push(patch.role);
        sets.push(`role = $${values.length}`);
      }
      if (patch.status !== undefined) values.push(patch.status) && sets.push(`status = $${values.length}`);
      if (patch.slackUserId !== undefined)
        values.push(patch.slackUserId) && sets.push(`"slackUserId" = $${values.length}`);
      if (sets.length > 0) {
        values.push(id, orgId);
        await pool.query(
          `UPDATE member SET ${sets.join(", ")} WHERE id = $${values.length - 1} AND "organizationId" = $${values.length}`,
          values,
        );
      }
      if (patch.name !== undefined) {
        await pool.query(
          `UPDATE "user" SET name = $1, "updatedAt" = now()
           WHERE id = (SELECT "userId" FROM member WHERE id = $2 AND "organizationId" = $3)`,
          [patch.name ?? "", id, orgId],
        );
      }
      return (await one("m.id = $2", [id])) as TinoUser;
    },
  };
}

interface IdentityRow {
  provider: string;
  external_id: string;
  tino_user_id: string;
  linked_at: string;
}

export function createPgIdentityStore({ pool, orgId }: { pool: PgPool; orgId: string }): IdentityStore {
  return {
    async resolve(provider: IdentityProvider, externalId: string): Promise<string | null> {
      const res = await pool.query<{ tino_user_id: string }>(
        "SELECT tino_user_id FROM identity WHERE provider = $1 AND external_id = $2 AND org_id = $3",
        [provider, externalId, orgId],
      );
      return res.rows[0]?.tino_user_id ?? null;
    },

    async link(identity: Identity): Promise<void> {
      try {
        await pool.query(
          "INSERT INTO identity (provider, external_id, tino_user_id, linked_at, org_id) VALUES ($1, $2, $3, $4, $5)",
          [identity.provider, identity.externalId, identity.tinoUserId, identity.linkedAt, orgId],
        );
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new IdentityLinkConflictError(identity.provider, identity.externalId);
        }
        throw err;
      }
    },

    async listForUser(tinoUserId: string): Promise<Identity[]> {
      const res = await pool.query<IdentityRow>(
        "SELECT * FROM identity WHERE tino_user_id = $1 AND org_id = $2 ORDER BY linked_at ASC",
        [tinoUserId, orgId],
      );
      return res.rows.map((row) => ({
        provider: row.provider as IdentityProvider,
        externalId: row.external_id,
        tinoUserId: row.tino_user_id,
        linkedAt: Number(row.linked_at),
      }));
    },
  };
}
