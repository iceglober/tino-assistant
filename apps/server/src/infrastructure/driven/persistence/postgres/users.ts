/**
 * Org-bound UserStore + IdentityStore. Every statement carries the org id the
 * store was built for. Case-insensitive email lookups go through the
 * (org_id, lower(email)) index; duplicate identity links surface as pg
 * unique-violation 23505 → rethrown as IdentityLinkConflictError.
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
  email: string;
  name: string | null;
  role: string;
  status: string;
  slack_user_id: string | null;
  created_at: string; // int8 comes back as string
  updated_at: string;
}

export function rowToUser(row: UserRow): TinoUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    role: row.role as TinoUser["role"],
    status: row.status as TinoUser["status"],
    slackUserId: row.slack_user_id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function createPgUserStore({ pool, orgId }: { pool: PgPool; orgId: string }): UserStore {
  return {
    async create(user: TinoUser): Promise<TinoUser> {
      await pool.query(
        `INSERT INTO tino_user (id, email, name, role, status, slack_user_id, created_at, updated_at, org_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.id,
          user.email.toLowerCase(),
          user.name ?? null,
          user.role,
          user.status,
          user.slackUserId,
          user.createdAt,
          user.updatedAt,
          orgId,
        ],
      );
      return user;
    },

    async get(id: string): Promise<TinoUser | null> {
      const res = await pool.query<UserRow>("SELECT * FROM tino_user WHERE id = $1 AND org_id = $2", [id, orgId]);
      return res.rows[0] ? rowToUser(res.rows[0]) : null;
    },

    async getByEmail(email: string): Promise<TinoUser | null> {
      const res = await pool.query<UserRow>("SELECT * FROM tino_user WHERE lower(email) = lower($1) AND org_id = $2", [
        email,
        orgId,
      ]);
      return res.rows[0] ? rowToUser(res.rows[0]) : null;
    },

    async list(): Promise<TinoUser[]> {
      const res = await pool.query<UserRow>("SELECT * FROM tino_user WHERE org_id = $1 ORDER BY created_at ASC", [orgId]);
      return res.rows.map(rowToUser);
    },

    async update(
      id: string,
      patch: Partial<Pick<TinoUser, "role" | "status" | "slackUserId" | "name">>,
    ): Promise<TinoUser> {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      let i = 1;
      if (patch.role !== undefined) sets.push(`role = $${i++}`) && values.push(patch.role);
      if (patch.status !== undefined) sets.push(`status = $${i++}`) && values.push(patch.status);
      if (patch.slackUserId !== undefined) sets.push(`slack_user_id = $${i++}`) && values.push(patch.slackUserId);
      if (patch.name !== undefined) sets.push(`name = $${i++}`) && values.push(patch.name ?? null);
      sets.push(`updated_at = $${i++}`);
      values.push(Date.now());
      values.push(id);
      values.push(orgId);

      const res = await pool.query<UserRow>(
        `UPDATE tino_user SET ${sets.join(", ")} WHERE id = $${i} AND org_id = $${i + 1} RETURNING *`,
        values,
      );
      if (!res.rows[0]) throw new Error(`tino_user not found: ${id}`);
      return rowToUser(res.rows[0]);
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
