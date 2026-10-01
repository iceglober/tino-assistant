import { Database } from "bun:sqlite";
import type { ConfigStore } from "@tino/core/ports/outbound";

/**
 * SQLite-backed ConfigStore. System-wide runtime config (Slack/Azure/Google
 * keys). Values are JSON strings; keys use dot-notation namespacing. Schema is
 * created on first use; no migrations — blow the file away if schema changes.
 */
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
