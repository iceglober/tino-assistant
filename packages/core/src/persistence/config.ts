import { Database } from "bun:sqlite";

/**
 * System-wide runtime configuration store backed by SQLite.
 *
 * Uses the same database file as conversation history, preferences, and tasks.
 * New table: config (key, value, updated_at).
 *
 * Values are JSON strings — callers use getTyped<T> to parse them.
 * Keys use dot-notation namespacing, e.g. "github.repos", "cloudwatch.log_groups".
 *
 * Schema is created on first use (CREATE TABLE IF NOT EXISTS).
 * No migrations — blow the file away if schema changes.
 */
export interface ConfigStore {
  /** Returns the raw JSON string for the key, or null if not set. */
  get(key: string): Promise<string | null>;
  /** Returns JSON.parse(value) if the key exists, otherwise returns fallback. */
  getTyped<T>(key: string, fallback: T): Promise<T>;
  /** JSON.stringify(value) and store under key. */
  set(key: string, value: unknown): Promise<void>;
  /** Returns all entries sorted by key. */
  list(): Promise<Array<{ key: string; value: string; updatedAt: number }>>;
  /** Deletes the entry. Returns true if it existed, false if not. */
  delete(key: string): Promise<boolean>;
}

interface ConfigRow {
  key: string;
  value: string;
  updated_at: number;
}

export function createConfigStore({ dbPath }: { dbPath: string }): ConfigStore {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key        TEXT    PRIMARY KEY,
      value      TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const stmtGet = db.query("SELECT value FROM config WHERE key = ?");

  const stmtUpsert = db.query(
    `INSERT INTO config (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value      = excluded.value,
       updated_at = excluded.updated_at`,
  );

  const stmtList = db.query("SELECT key, value, updated_at FROM config ORDER BY key");

  const stmtDelete = db.query("DELETE FROM config WHERE key = ?");

  return {
    get(key: string): Promise<string | null> {
      const row = stmtGet.get(key) as { value: string } | null;
      return Promise.resolve(row?.value ?? null);
    },

    getTyped<T>(key: string, fallback: T): Promise<T> {
      const raw = stmtGet.get(key) as { value: string } | null;
      if (!raw) return Promise.resolve(fallback);
      try {
        return Promise.resolve(JSON.parse(raw.value) as T);
      } catch {
        return Promise.resolve(fallback);
      }
    },

    set(key: string, value: unknown): Promise<void> {
      stmtUpsert.run(key, JSON.stringify(value), Date.now());
      return Promise.resolve();
    },

    list(): Promise<Array<{ key: string; value: string; updatedAt: number }>> {
      return Promise.resolve(
        (stmtList.all() as ConfigRow[]).map((row) => ({
          key: row.key,
          value: row.value,
          updatedAt: row.updated_at,
        })),
      );
    },

    delete(key: string): Promise<boolean> {
      const info = stmtDelete.run(key);
      return Promise.resolve(info.changes > 0);
    },
  };
}
