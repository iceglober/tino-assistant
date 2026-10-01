/**
 * Org-bound ConversationLog: one row per message in insertion order, each
 * thread trimmed to its newest `keepPerThread` messages. message_json is TEXT,
 * not JSONB, because model output can contain \u0000 escapes JSONB rejects.
 */
import { describeWhoCanSee, parseWhoCanSee } from "@tino/core/domain/who-can-see";
import type { AskedWhere, ConversationLog, LoggedMessage } from "@tino/core/ports/outbound";
import type { PgPool } from "../db.js";

interface Row {
  thread_key: string;
  turn_id: string;
  asked_by: string;
  asked_where: string;
  who_can_see: string;
  role: string;
  text: string | null;
  message_json: string;
  created_at: string;
}

const toMessage = (r: Row): LoggedMessage => ({
  threadKey: r.thread_key,
  turnId: r.turn_id,
  askedBy: r.asked_by,
  askedWhere: r.asked_where as AskedWhere,
  whoCanSee: parseWhoCanSee(r.who_can_see),
  role: r.role as LoggedMessage["role"],
  text: r.text,
  message: JSON.parse(r.message_json),
  createdAt: Number(r.created_at),
});

export function createPgConversationLog({
  pool,
  orgId,
  keepPerThread = 200,
}: {
  pool: PgPool;
  orgId: string;
  keepPerThread?: number;
}): ConversationLog {
  return {
    async append(messages) {
      if (messages.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const m of messages) {
          await client.query(
            `INSERT INTO conversation_message
               (thread_key, turn_id, asked_by, asked_where, who_can_see, role, text, message_json, created_at, org_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              m.threadKey,
              m.turnId,
              m.askedBy,
              m.askedWhere,
              describeWhoCanSee(m.whoCanSee),
              m.role,
              m.text,
              JSON.stringify(m.message),
              m.createdAt,
              orgId,
            ],
          );
        }
        for (const threadKey of new Set(messages.map((m) => m.threadKey))) {
          await client.query(
            `DELETE FROM conversation_message WHERE org_id = $3 AND thread_key = $1 AND id NOT IN
               (SELECT id FROM conversation_message WHERE org_id = $3 AND thread_key = $1 ORDER BY id DESC LIMIT $2)`,
            [threadKey, keepPerThread, orgId],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async recentInThread(threadKey, limit) {
      const res = await pool.query<Row>(
        "SELECT * FROM conversation_message WHERE org_id = $3 AND thread_key = $1 ORDER BY id DESC LIMIT $2",
        [threadKey, limit, orgId],
      );
      return res.rows.reverse().map(toMessage);
    },

    async recentAskedBy(userId, limit) {
      const res = await pool.query<Row>(
        "SELECT * FROM conversation_message WHERE org_id = $3 AND asked_by = $1 ORDER BY id DESC LIMIT $2",
        [userId, limit, orgId],
      );
      return res.rows.reverse().map(toMessage);
    },

    async clearThread(threadKey) {
      await pool.query("DELETE FROM conversation_message WHERE org_id = $2 AND thread_key = $1", [threadKey, orgId]);
    },
  };
}
