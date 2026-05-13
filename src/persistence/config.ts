import Database from 'better-sqlite3';

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
  get(key: string): string | null;
  /** Returns JSON.parse(value) if the key exists, otherwise returns fallback. */
  getTyped<T>(key: string, fallback: T): T;
  /** JSON.stringify(value) and store under key. */
  set(key: string, value: unknown): void;
  /** Returns all entries sorted by key. */
  list(): Array<{ key: string; value: string; updatedAt: number }>;
  /** Deletes the entry. Returns true if it existed, false if not. */
  delete(key: string): boolean;
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

  const stmtGet = db.prepare<[string], { value: string }>(
    'SELECT value FROM config WHERE key = ?',
  );

  const stmtUpsert = db.prepare<[string, string, number]>(
    `INSERT INTO config (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value      = excluded.value,
       updated_at = excluded.updated_at`,
  );

  const stmtList = db.prepare<[], ConfigRow>(
    'SELECT key, value, updated_at FROM config ORDER BY key',
  );

  const stmtDelete = db.prepare<[string]>(
    'DELETE FROM config WHERE key = ?',
  );

  return {
    get(key: string): string | null {
      const row = stmtGet.get(key);
      return row?.value ?? null;
    },

    getTyped<T>(key: string, fallback: T): T {
      const raw = stmtGet.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw.value) as T;
      } catch {
        return fallback;
      }
    },

    set(key: string, value: unknown): void {
      stmtUpsert.run(key, JSON.stringify(value), Date.now());
    },

    list(): Array<{ key: string; value: string; updatedAt: number }> {
      return stmtList.all().map(row => ({
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at,
      }));
    },

    delete(key: string): boolean {
      const info = stmtDelete.run(key);
      return info.changes > 0;
    },
  };
}
