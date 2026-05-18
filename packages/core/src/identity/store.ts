import { Database, SQLiteError } from "bun:sqlite";
import type { Identity, IdentityProvider, TinoUser } from "./types.js";

/**
 * Per-user record store. Mirrors the factory pattern used by
 * `persistence/preferences.ts` — a sqlite implementation here, a dynamo one
 * under `@tino/aws/persistence/dynamo/users.ts`.
 *
 * Schema (sqlite): `tino_user (id PK, email indexed, name, role, status,
 * slack_user_id, created_at, updated_at)`. Email lookups are case-insensitive
 * because both google profile addresses and slack email addresses are
 * canonically lowercased on write but defensive lookups still normalize.
 */
export interface UserStore {
  /** Create a new tino user. Throws on duplicate id. */
  create(user: TinoUser): Promise<TinoUser>;
  /** Fetch by tino-UUID. Returns null when not found. */
  get(id: string): Promise<TinoUser | null>;
  /** Fetch by email (case-insensitive). Returns null when not found. */
  getByEmail(email: string): Promise<TinoUser | null>;
  /** List all users, ordered by createdAt ascending. Admin-only access in wave 4. */
  list(): Promise<TinoUser[]>;
  /** Patch mutable fields. Throws when id is not found. */
  update(id: string, patch: Partial<Pick<TinoUser, "role" | "status" | "slackUserId" | "name">>): Promise<TinoUser>;
}

/**
 * External-identity link store. Many-to-one with `UserStore`: a single
 * tino user can have multiple identities (typically one slack + one google).
 *
 * Schema (sqlite): `identity (provider, external_id, tino_user_id, linked_at)`
 * with PRIMARY KEY (provider, external_id) — guarantees one tino user per
 * external identity. Duplicate links surface as a typed conflict (a2).
 */
export interface IdentityStore {
  /**
   * Resolve a `(provider, externalId)` pair to its linked tinoUserId, or null
   * when no link exists. The fundamental read used by the resolver.
   */
  resolve(provider: IdentityProvider, externalId: string): Promise<string | null>;
  /** Link a new identity. Throws on duplicate `(provider, externalId)`. */
  link(identity: Identity): Promise<void>;
  /** List all linked identities for a given tino user. */
  listForUser(tinoUserId: string): Promise<Identity[]>;
}

/**
 * Surfaced when `link` is called for a `(provider, externalId)` pair that is
 * already taken. Callers (e.g. the migration) treat this as the "already
 * linked" signal during idempotent retries.
 */
export class IdentityLinkConflictError extends Error {
  constructor(provider: IdentityProvider, externalId: string) {
    super(`identity (${provider}, ${externalId}) is already linked`);
    this.name = "IdentityLinkConflictError";
  }
}

// ─── Row shapes (sqlite-internal) ────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  slack_user_id: string | null;
  created_at: number;
  updated_at: number;
}

interface IdentityRow {
  provider: string;
  external_id: string;
  tino_user_id: string;
  linked_at: number;
}

function rowToUser(row: UserRow): TinoUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    role: row.role as TinoUser["role"],
    status: row.status as TinoUser["status"],
    slackUserId: row.slack_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToIdentity(row: IdentityRow): Identity {
  return {
    provider: row.provider as IdentityProvider,
    externalId: row.external_id,
    tinoUserId: row.tino_user_id,
    linkedAt: row.linked_at,
  };
}

// ─── Sqlite factories ────────────────────────────────────────────────────────

/**
 * Build a sqlite-backed UserStore. Creates the `tino_user` table on first use.
 * Schema is `CREATE TABLE IF NOT EXISTS` — rerunning is safe.
 */
export function createSqliteUserStore({ dbPath }: { dbPath: string }): UserStore {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tino_user (
      id            TEXT    PRIMARY KEY,
      email         TEXT    NOT NULL,
      name          TEXT,
      role          TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      slack_user_id TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tino_user_email_idx ON tino_user (email COLLATE NOCASE);
  `);

  const stmtInsert = db.query(
    `INSERT INTO tino_user (id, email, name, role, status, slack_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtGet = db.query("SELECT * FROM tino_user WHERE id = ?");
  // COLLATE NOCASE on email lookup matches the index above so case differs
  // (e.g. 'Foo@Bar.com' vs 'foo@bar.com') still hit the same row.
  const stmtGetByEmail = db.query("SELECT * FROM tino_user WHERE email = ? COLLATE NOCASE");
  const stmtList = db.query("SELECT * FROM tino_user ORDER BY created_at ASC");

  return {
    create(user: TinoUser): Promise<TinoUser> {
      stmtInsert.run(
        user.id,
        user.email,
        user.name ?? null,
        user.role,
        user.status,
        user.slackUserId,
        user.createdAt,
        user.updatedAt,
      );
      return Promise.resolve(user);
    },

    get(id: string): Promise<TinoUser | null> {
      const row = stmtGet.get(id) as UserRow | null;
      return Promise.resolve(row ? rowToUser(row) : null);
    },

    getByEmail(email: string): Promise<TinoUser | null> {
      const row = stmtGetByEmail.get(email) as UserRow | null;
      return Promise.resolve(row ? rowToUser(row) : null);
    },

    list(): Promise<TinoUser[]> {
      return Promise.resolve((stmtList.all() as UserRow[]).map(rowToUser));
    },

    update(id: string, patch: Partial<Pick<TinoUser, "role" | "status" | "slackUserId" | "name">>): Promise<TinoUser> {
      // Build the SET list dynamically so we only touch fields the caller
      // passed. updated_at is always rewritten.
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      if (patch.role !== undefined) {
        sets.push("role = ?");
        values.push(patch.role);
      }
      if (patch.status !== undefined) {
        sets.push("status = ?");
        values.push(patch.status);
      }
      if (patch.slackUserId !== undefined) {
        sets.push("slack_user_id = ?");
        values.push(patch.slackUserId);
      }
      if (patch.name !== undefined) {
        sets.push("name = ?");
        values.push(patch.name);
      }
      sets.push("updated_at = ?");
      values.push(Date.now());
      values.push(id);

      const info = db.prepare(`UPDATE tino_user SET ${sets.join(", ")} WHERE id = ?`).run(...values);
      if (info.changes === 0) {
        throw new Error(`tino_user not found: ${id}`);
      }

      const row = stmtGet.get(id) as UserRow | null;
      if (!row) throw new Error(`tino_user disappeared after update: ${id}`);
      return Promise.resolve(rowToUser(row));
    },
  };
}

/**
 * Build a sqlite-backed IdentityStore. The PRIMARY KEY (provider,
 * external_id) gives us duplicate-link rejection for free — the bun:sqlite
 * `SQLITE_CONSTRAINT_PRIMARYKEY` exception is rewrapped as
 * `IdentityLinkConflictError` so callers can branch on the "already linked"
 * case without parsing error text.
 */
export function createSqliteIdentityStore({ dbPath }: { dbPath: string }): IdentityStore {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS identity (
      provider      TEXT    NOT NULL,
      external_id   TEXT    NOT NULL,
      tino_user_id  TEXT    NOT NULL,
      linked_at     INTEGER NOT NULL,
      PRIMARY KEY (provider, external_id)
    );
    CREATE INDEX IF NOT EXISTS identity_user_idx ON identity (tino_user_id);
  `);

  const stmtResolve = db.query("SELECT tino_user_id FROM identity WHERE provider = ? AND external_id = ?");
  const stmtInsert = db.query(
    `INSERT INTO identity (provider, external_id, tino_user_id, linked_at)
     VALUES (?, ?, ?, ?)`,
  );
  const stmtListForUser = db.query("SELECT * FROM identity WHERE tino_user_id = ? ORDER BY linked_at ASC");

  return {
    resolve(provider: IdentityProvider, externalId: string): Promise<string | null> {
      const row = stmtResolve.get(provider, externalId) as { tino_user_id: string } | null;
      return Promise.resolve(row?.tino_user_id ?? null);
    },

    link(identity: Identity): Promise<void> {
      try {
        stmtInsert.run(identity.provider, identity.externalId, identity.tinoUserId, identity.linkedAt);
      } catch (err) {
        // bun:sqlite surfaces UNIQUE/PRIMARY KEY violations as SQLiteError
        // with a code beginning with `SQLITE_CONSTRAINT`. Wrap so callers can
        // branch on the typed conflict instead of error-message parsing.
        if (err instanceof SQLiteError && err.code?.startsWith("SQLITE_CONSTRAINT")) {
          throw new IdentityLinkConflictError(identity.provider, identity.externalId);
        }
        throw err;
      }
      return Promise.resolve();
    },

    listForUser(tinoUserId: string): Promise<Identity[]> {
      return Promise.resolve((stmtListForUser.all(tinoUserId) as IdentityRow[]).map(rowToIdentity));
    },
  };
}
