/**
 * Postgres/pgvector adapter for the KnowledgeStore port.
 *
 * Search is two-stage: HNSW ANN oversample (topK×5, ef_search=80 — scope/user
 * WHERE clauses post-filter the ANN scan, so oversampling protects recall),
 * then a recency-weighted rerank in SQL:
 *   score = (1−w)·sim + w·exp(−age/τ)
 * so a 2-month-old chunk must beat a fresh one by a decisive similarity margin.
 */
import { createHash } from "node:crypto";
import type {
  KbChunk,
  KbIndexState,
  KbScope,
  KbSearchHit,
  KbSearchQuery,
  KbSource,
  KnowledgeStore,
} from "../../../ports/outbound.js";
import type { PgPool } from "../persistence/postgres/client.js";
import { KB_EMBED_DIMS, KB_EMBED_MODEL } from "./schema.js";

const toVectorLiteral = (v: number[]): string => `[${v.join(",")}]`;
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

interface StateRow {
  scope: string;
  user_id: string;
  source: string;
  status: string;
  backfill_done: boolean;
  last_cycle_at: Date | null;
  paused_at: Date | null;
  last_error: string | null;
}

function rowToState(r: StateRow): KbIndexState {
  return {
    scope: r.scope as KbScope,
    userId: r.user_id,
    source: r.source as "slack" | "gmail",
    status: r.status as KbIndexState["status"],
    backfillDone: r.backfill_done,
    lastCycleAt: r.last_cycle_at?.getTime(),
    pausedAt: r.paused_at?.getTime(),
    lastError: r.last_error ?? undefined,
  };
}

export function createPgKnowledgeStore({ pool }: { pool: PgPool }): KnowledgeStore {
  return {
    async upsertChunks(chunks: KbChunk[], embeddings: number[][]): Promise<number> {
      if (chunks.length !== embeddings.length) {
        throw new Error(`chunk/embedding count mismatch: ${chunks.length} vs ${embeddings.length}`);
      }
      let written = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i] as KbChunk;
        const emb = embeddings[i] as number[];
        if (emb.length !== KB_EMBED_DIMS) {
          throw new Error(`embedding dims ${emb.length} != ${KB_EMBED_DIMS} for ${c.sourceRef}`);
        }
        const res = await pool.query(
          `INSERT INTO kb_chunks (scope, user_id, source, source_ref, chunk_seq, text, embedding, embed_model, ts, permalink, meta, content_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7::halfvec(${KB_EMBED_DIMS}),$8,$9,$10,$11::jsonb,$12)
           ON CONFLICT (scope, user_id, source, source_ref, chunk_seq) DO UPDATE SET
             text = EXCLUDED.text, embedding = EXCLUDED.embedding, embed_model = EXCLUDED.embed_model,
             ts = EXCLUDED.ts, permalink = EXCLUDED.permalink, meta = EXCLUDED.meta,
             content_hash = EXCLUDED.content_hash, indexed_at = now()
           WHERE kb_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash`,
          [
            c.scope,
            c.userId,
            c.source,
            c.sourceRef,
            c.chunkSeq,
            c.text,
            toVectorLiteral(emb),
            KB_EMBED_MODEL,
            new Date(c.ts).toISOString(),
            c.permalink ?? null,
            JSON.stringify(c.meta ?? {}),
            sha256(c.text),
          ],
        );
        written += res.rowCount ?? 0;
      }
      return written;
    },

    async listChunks(scope, userId, opts) {
      const params: unknown[] = [scope, userId, opts.source ?? null];
      const res = await pool.query(
        `SELECT id, text, source, source_ref, chunk_seq, ts, permalink, meta, indexed_at,
                count(*) OVER () AS total
         FROM kb_chunks
         WHERE scope = $1 AND user_id = $2 AND ($3::text IS NULL OR source = $3)
         ORDER BY ts DESC
         LIMIT $4 OFFSET $5`,
        [...params, opts.limit, opts.offset],
      );
      return {
        total: res.rows[0] ? Number(res.rows[0].total) : 0,
        items: res.rows.map((r) => ({
          id: String(r.id),
          text: r.text as string,
          source: r.source as KbSource,
          sourceRef: r.source_ref as string,
          chunkSeq: Number(r.chunk_seq),
          ts: (r.ts as Date).getTime(),
          permalink: (r.permalink as string | null) ?? undefined,
          meta: (r.meta as Record<string, unknown>) ?? {},
          indexedAt: (r.indexed_at as Date).getTime(),
        })),
      };
    },

    async statsBySource(scope, userId) {
      const res = await pool.query<{ source: string; chunks: string; newest: Date | null }>(
        `SELECT source, count(*) AS chunks, max(ts) AS newest
         FROM kb_chunks WHERE scope = $1 AND user_id = $2
         GROUP BY source ORDER BY source`,
        [scope, userId],
      );
      return res.rows.map((r) => ({
        source: r.source as KbSource,
        chunks: Number(r.chunks),
        newestMs: r.newest ? r.newest.getTime() : null,
      }));
    },

    async deleteStaleSeqs(scope, userId, source, sourceRef, maxSeq): Promise<void> {
      await pool.query(
        "DELETE FROM kb_chunks WHERE scope=$1 AND user_id=$2 AND source=$3 AND source_ref=$4 AND chunk_seq > $5",
        [scope, userId, source, sourceRef, maxSeq],
      );
    },

    async search(q: KbSearchQuery): Promise<KbSearchHit[]> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL hnsw.ef_search = 80");
        const w = q.afterMs !== undefined || q.beforeMs !== undefined ? 0 : q.recencyWeight;
        const res = await client.query(
          `WITH candidates AS (
             SELECT text, source, ts, permalink, meta,
                    1 - (embedding <=> $1::halfvec(${KB_EMBED_DIMS})) AS sim
             FROM kb_chunks
             WHERE scope = $2 AND user_id = $3
               AND ($4::timestamptz IS NULL OR ts >= $4)
               AND ($5::timestamptz IS NULL OR ts <= $5)
               AND ($6::text[] IS NULL OR source = ANY($6))
             ORDER BY embedding <=> $1::halfvec(${KB_EMBED_DIMS})
             LIMIT GREATEST($7::int * 5, 40)
           )
           SELECT text, source, ts, permalink, meta, sim,
                  (1 - $8::float8) * sim
                  + $8::float8 * exp(-extract(epoch FROM now() - ts) / ($9::float8 * 86400)) AS score
           FROM candidates
           ORDER BY score DESC
           LIMIT $7::int`,
          [
            toVectorLiteral(q.embedding),
            q.scope,
            q.userId,
            q.afterMs !== undefined ? new Date(q.afterMs).toISOString() : null,
            q.beforeMs !== undefined ? new Date(q.beforeMs).toISOString() : null,
            q.sources && q.sources.length > 0 ? q.sources : null,
            q.topK,
            w,
            q.recencyTauDays,
          ],
        );
        await client.query("COMMIT");
        return res.rows.map((r) => ({
          text: r.text as string,
          source: r.source as KbSource,
          ts: (r.ts as Date).getTime(),
          permalink: (r.permalink as string | null) ?? undefined,
          meta: (r.meta as Record<string, unknown>) ?? {},
          sim: Number(r.sim),
          score: Number(r.score),
        }));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async stats(scope, userId) {
      const res = await pool.query<{ chunks: string; oldest: Date | null; newest: Date | null }>(
        "SELECT count(*) AS chunks, min(ts) AS oldest, max(ts) AS newest FROM kb_chunks WHERE scope=$1 AND user_id=$2",
        [scope, userId],
      );
      const row = res.rows[0];
      return {
        chunks: Number(row?.chunks ?? 0),
        oldestMs: row?.oldest ? row.oldest.getTime() : null,
        newestMs: row?.newest ? row.newest.getTime() : null,
      };
    },

    async forgetUser(userId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM kb_chunks WHERE scope='user' AND user_id=$1", [userId]);
        await client.query("DELETE FROM kb_cursors WHERE scope='user' AND user_id=$1", [userId]);
        // Tombstone (not delete) — auto-consent must not re-index next cycle.
        for (const source of ["slack", "gmail"]) {
          await client.query(
            `INSERT INTO kb_index_state (scope, user_id, source, status, backfill_done, paused_at)
             VALUES ('user', $1, $2, 'disabled', false, now())
             ON CONFLICT (scope, user_id, source)
             DO UPDATE SET status='disabled', backfill_done=false, paused_at=now(), last_error=NULL`,
            [userId, source],
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

    async getCursor(scope, userId, source, stream) {
      const res = await pool.query<{ state: Record<string, unknown> }>(
        "SELECT state FROM kb_cursors WHERE scope=$1 AND user_id=$2 AND source=$3 AND stream=$4",
        [scope, userId, source, stream],
      );
      return res.rows[0]?.state ?? null;
    },

    async setCursor(scope, userId, source, stream, state) {
      await pool.query(
        `INSERT INTO kb_cursors (scope, user_id, source, stream, state, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,now())
         ON CONFLICT (scope, user_id, source, stream)
         DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [scope, userId, source, stream, JSON.stringify(state)],
      );
    },

    async getIndexState(scope, userId, source) {
      const res = await pool.query<StateRow>(
        "SELECT * FROM kb_index_state WHERE scope=$1 AND user_id=$2 AND source=$3",
        [scope, userId, source],
      );
      return res.rows[0] ? rowToState(res.rows[0]) : null;
    },

    async setIndexState(state: KbIndexState) {
      await pool.query(
        `INSERT INTO kb_index_state (scope, user_id, source, status, backfill_done, last_cycle_at, paused_at, last_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (scope, user_id, source) DO UPDATE SET
           status = EXCLUDED.status, backfill_done = EXCLUDED.backfill_done,
           last_cycle_at = EXCLUDED.last_cycle_at, paused_at = EXCLUDED.paused_at,
           last_error = EXCLUDED.last_error`,
        [
          state.scope,
          state.userId,
          state.source,
          state.status,
          state.backfillDone,
          state.lastCycleAt !== undefined ? new Date(state.lastCycleAt).toISOString() : null,
          state.pausedAt !== undefined ? new Date(state.pausedAt).toISOString() : null,
          state.lastError ?? null,
        ],
      );
    },

    async listIndexStates() {
      const res = await pool.query<StateRow>("SELECT * FROM kb_index_state ORDER BY scope, user_id, source");
      return res.rows.map(rowToState);
    },
  };
}
