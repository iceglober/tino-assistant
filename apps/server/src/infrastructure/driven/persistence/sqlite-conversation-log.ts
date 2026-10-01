import { Database } from "bun:sqlite";
import { describeWhoCanSee, parseWhoCanSee } from "@tino/core/domain/who-can-see";
import type { AskedWhere, ConversationLog, LoggedMessage, Logger } from "@tino/core/ports/outbound";
import { type ImportedRow, importLegacyHistory } from "./legacy-history.js";

/**
 * SQLite ConversationLog (local dev). One row per message, in insertion order.
 * Each thread keeps its newest `keepPerThread` messages.
 */
interface Row {
  thread_key: string;
  turn_id: string;
  asked_by: string;
  asked_where: string;
  who_can_see: string;
  role: string;
  text: string | null;
  message_json: string;
  created_at: number;
}

export function createSqliteConversationLog({
  dbPath,
  keepPerThread = 200,
  logger,
}: {
  dbPath: string;
  keepPerThread?: number;
  logger?: Logger;
}): ConversationLog {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_message (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_key   TEXT    NOT NULL,
      turn_id      TEXT    NOT NULL,
      asked_by     TEXT    NOT NULL,
      asked_where  TEXT    NOT NULL,
      who_can_see  TEXT    NOT NULL,
      role         TEXT    NOT NULL,
      text         TEXT,
      message_json TEXT    NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_message_thread_idx ON conversation_message (thread_key, id);
    CREATE INDEX IF NOT EXISTS conversation_message_asked_by_idx ON conversation_message (asked_by, id);
  `);

  const insert = db.query(
    `INSERT INTO conversation_message
       (thread_key, turn_id, asked_by, asked_where, who_can_see, role, text, message_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const prune = db.query(
    `DELETE FROM conversation_message WHERE thread_key = ? AND id NOT IN
       (SELECT id FROM conversation_message WHERE thread_key = ? ORDER BY id DESC LIMIT ?)`,
  );
  const byThread = db.query(`SELECT * FROM conversation_message WHERE thread_key = ? ORDER BY id DESC LIMIT ?`);
  const byAsker = db.query(`SELECT * FROM conversation_message WHERE asked_by = ? ORDER BY id DESC LIMIT ?`);
  const clear = db.query(`DELETE FROM conversation_message WHERE thread_key = ?`);

  const insertRows = db.transaction((rows: ImportedRow[]) => {
    for (const r of rows) {
      insert.run(
        r.threadKey,
        r.turnId,
        r.askedBy,
        r.askedWhere,
        r.whoCanSee,
        r.role,
        r.text,
        r.messageJson,
        r.createdAt,
      );
    }
  });

  importOldHistoryOnce(db, insertRows, logger);

  const toMessage = (r: Row): LoggedMessage => ({
    threadKey: r.thread_key,
    turnId: r.turn_id,
    askedBy: r.asked_by,
    askedWhere: r.asked_where as AskedWhere,
    whoCanSee: parseWhoCanSee(r.who_can_see),
    role: r.role as LoggedMessage["role"],
    text: r.text,
    message: JSON.parse(r.message_json),
    createdAt: r.created_at,
  });

  return {
    append(messages) {
      insertRows(
        messages.map((m) => ({
          threadKey: m.threadKey,
          turnId: m.turnId,
          askedBy: m.askedBy,
          askedWhere: m.askedWhere,
          whoCanSee: describeWhoCanSee(m.whoCanSee),
          role: m.role,
          text: m.text,
          messageJson: JSON.stringify(m.message),
          createdAt: m.createdAt,
        })),
      );
      for (const threadKey of new Set(messages.map((m) => m.threadKey))) prune.run(threadKey, threadKey, keepPerThread);
      return Promise.resolve();
    },

    recentInThread(threadKey, limit) {
      return Promise.resolve((byThread.all(threadKey, limit) as Row[]).reverse().map(toMessage));
    },

    recentAskedBy(userId, limit) {
      return Promise.resolve((byAsker.all(userId, limit) as Row[]).reverse().map(toMessage));
    },

    clearThread(threadKey) {
      clear.run(threadKey);
      return Promise.resolve();
    },
  };
}

/**
 * Move the old per-user history (`conversations`) into the log, once. The old
 * table is renamed, not dropped, so nothing is lost if this needs revisiting.
 */
function importOldHistoryOnce(db: Database, insertRows: (rows: ImportedRow[]) => void, logger?: Logger): void {
  const old = db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversations'`).get();
  if (!old) return;
  const rows = db.query(`SELECT user_id, messages_json, updated_at FROM conversations`).all() as Array<{
    user_id: string;
    messages_json: string;
    updated_at: number;
  }>;
  const imported = rows.flatMap((r) => importLegacyHistory(r.user_id, r.messages_json, r.updated_at));
  db.transaction(() => {
    insertRows(imported);
    db.exec(`ALTER TABLE conversations RENAME TO conversations_before_log`);
  })();
  logger?.info({ conversations: rows.length, messages: imported.length }, "imported old conversation history");
}
