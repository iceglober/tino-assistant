import { Database } from "bun:sqlite";
import type { ModelMessage } from "ai";
import type { HistoryStore } from "../agent/history.js";
import { trim } from "../agent/history.js";

/**
 * SQLite-backed HistoryStore.
 *
 * Schema: conversations (user_id TEXT PRIMARY KEY, messages_json TEXT NOT NULL, updated_at INTEGER NOT NULL)
 *
 * Uses bun:sqlite (synchronous API) — matches the synchronous HistoryStore interface.
 * No migrations: single CREATE TABLE IF NOT EXISTS at construction time.
 * No WAL mode, no extra pragmas, no in-memory cache — synchronous reads are sub-millisecond.
 */
export function createSqliteHistoryStore({ dbPath, cap = 40 }: { dbPath: string; cap?: number }): HistoryStore {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      user_id      TEXT    PRIMARY KEY,
      messages_json TEXT   NOT NULL,
      updated_at   INTEGER NOT NULL
    )
  `);

  const stmtGet = db.query("SELECT messages_json FROM conversations WHERE user_id = ?");

  const stmtUpsert = db.query(
    `INSERT INTO conversations (user_id, messages_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       messages_json = excluded.messages_json,
       updated_at    = excluded.updated_at`,
  );

  const stmtDelete = db.query("DELETE FROM conversations WHERE user_id = ?");

  return {
    get(userId: string): Promise<ModelMessage[]> {
      const row = stmtGet.get(userId) as { messages_json: string } | null;
      if (!row) return Promise.resolve([]);
      return Promise.resolve(JSON.parse(row.messages_json) as ModelMessage[]);
    },

    async append(userId: string, msgs: ModelMessage[]): Promise<void> {
      const existing = await this.get(userId);
      const combined = [...existing, ...msgs];
      const trimmed = trim(combined, cap);
      stmtUpsert.run(userId, JSON.stringify(trimmed), Date.now());
    },

    reset(userId: string): Promise<void> {
      stmtDelete.run(userId);
      return Promise.resolve();
    },
  };
}
