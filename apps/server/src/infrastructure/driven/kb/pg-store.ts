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
  KbBrowseItem,
  KbChunk,
  KbCycleEvent,
  KbEvidence,
  KbFact,
  KbFactKind,
  KbIndexState,
  KbScope,
  KbSearchHit,
  KbSearchQuery,
  KbSource,
  KbTopic,
  KbTopicDraft,
  KnowledgeStore,
} from "@tino/core/ports/outbound";
import type { PgPool } from "../persistence/postgres/client.js";
import { KB_EMBED_DIMS, KB_EMBED_MODEL, KB_EVENT_RETENTION_DAYS } from "./schema.js";

const toVectorLiteral = (v: number[]): string => `[${v.join(",")}]`;
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** pgvector renders vectors as '[a,b,c]'. */
const parseVectorLiteral = (raw: string): number[] =>
  raw.slice(1, -1).split(",").map(Number);

/** Keep the newest N receipts per fact — enough to justify it, bounded in size. */
const EVIDENCE_CAP = 8;

/**
 * Clustering runs on the leading 256 dims. gemini-embedding-001 is Matryoshka-
 * trained, so a truncated prefix is a valid (much cheaper) embedding rather
 * than an arbitrary slice — 3072 dims × thousands of chunks will not fit in
 * memory, 256 comfortably does.
 */
export const KB_CLUSTER_DIMS = 256;

function mergeEvidence(existing: KbEvidence[], incoming: KbEvidence[]): KbEvidence[] {
  const byChunk = new Map<string, KbEvidence>();
  for (const e of [...existing, ...incoming]) byChunk.set(e.chunkId, e);
  return [...byChunk.values()].sort((a, b) => b.ts - a.ts).slice(0, EVIDENCE_CAP);
}

interface FactRow {
  id: string;
  scope: string;
  user_id: string;
  kind: string;
  subject: string;
  statement: string;
  detail: string | null;
  fact_key: string;
  confidence: number;
  first_seen: Date;
  last_seen: Date;
  evidence: KbEvidence[];
  updated_at: Date;
}

function rowToFact(r: FactRow): KbFact {
  return {
    id: String(r.id),
    scope: r.scope as KbScope,
    userId: r.user_id,
    kind: r.kind as KbFactKind,
    subject: r.subject,
    statement: r.statement,
    detail: r.detail ?? undefined,
    key: r.fact_key,
    confidence: Number(r.confidence),
    firstSeenMs: r.first_seen.getTime(),
    lastSeenMs: r.last_seen.getTime(),
    evidence: Array.isArray(r.evidence) ? r.evidence : [],
    updatedAt: r.updated_at.getTime(),
  };
}

interface ChunkRow {
  id: string;
  text: string;
  source: string;
  source_ref: string;
  chunk_seq: number;
  ts: Date;
  permalink: string | null;
  meta: Record<string, unknown> | null;
  indexed_at: Date;
}

const rowToChunk = (r: ChunkRow): KbBrowseItem => ({
  id: String(r.id),
  text: r.text,
  source: r.source as KbSource,
  sourceRef: r.source_ref,
  chunkSeq: Number(r.chunk_seq),
  ts: r.ts.getTime(),
  permalink: r.permalink ?? undefined,
  meta: r.meta ?? {},
  indexedAt: r.indexed_at.getTime(),
});

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
             content_hash = EXCLUDED.content_hash, indexed_at = now(),
             -- content moved, so whatever was distilled from it is stale
             synthesized_at = NULL
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
        items: res.rows.map((r) => rowToChunk(r as ChunkRow)),
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
        // Derived knowledge first — facts and topics are worthless without the
        // chunks they cite, and leaving them would leak content after a wipe.
        await client.query("DELETE FROM kb_facts WHERE scope='private' AND user_id=$1", [userId]);
        await client.query("DELETE FROM kb_topics WHERE scope='private' AND user_id=$1", [userId]);
        await client.query("DELETE FROM kb_chunks WHERE scope='private' AND user_id=$1", [userId]);
        await client.query("DELETE FROM kb_cursors WHERE scope='private' AND user_id=$1", [userId]);
        // Tombstone (not delete) — auto-consent must not re-index next cycle.
        for (const source of ["slack", "gmail"]) {
          await client.query(
            `INSERT INTO kb_index_state (scope, user_id, source, status, backfill_done, paused_at)
             VALUES ('private', $1, $2, 'disabled', false, now())
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

    async forgetSourceItems(scope, userId, source, sourceRefs) {
      const none = { excerptsRemoved: 0, factsRemoved: 0, factsTrimmed: 0 };
      if (sourceRefs.length === 0) return none;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const deleted = await client.query<{ id: string }>(
          "DELETE FROM kb_chunks WHERE scope=$1 AND user_id=$2 AND source=$3 AND source_ref = ANY($4) RETURNING id",
          [scope, userId, source, sourceRefs],
        );
        const gone = new Set(deleted.rows.map((r) => String(r.id)));
        if (gone.size === 0) {
          await client.query("COMMIT");
          return none;
        }

        // Facts citing any removed excerpt: drop those citations; a fact with
        // nothing left to stand on goes too.
        const citing = await client.query<{ id: string; evidence: KbEvidence[] }>(
          `SELECT id, evidence FROM kb_facts
           WHERE scope=$1 AND user_id=$2
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(evidence) e WHERE e->>'chunkId' = ANY($3))`,
          [scope, userId, [...gone]],
        );
        let factsRemoved = 0;
        let factsTrimmed = 0;
        for (const fact of citing.rows) {
          const remaining = (Array.isArray(fact.evidence) ? fact.evidence : []).filter((e) => !gone.has(String(e.chunkId)));
          if (remaining.length === 0) {
            await client.query("DELETE FROM kb_facts WHERE id=$1", [fact.id]);
            factsRemoved++;
          } else {
            const times = remaining.map((e) => e.ts);
            await client.query(
              "UPDATE kb_facts SET evidence=$2::jsonb, first_seen=$3, last_seen=$4, updated_at=now() WHERE id=$1",
              [
                fact.id,
                JSON.stringify(remaining),
                new Date(Math.min(...times)).toISOString(),
                new Date(Math.max(...times)).toISOString(),
              ],
            );
            factsTrimmed++;
          }
        }
        await client.query("COMMIT");
        return { excerptsRemoved: gone.size, factsRemoved, factsTrimmed };
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

    // ── Distilled knowledge ──────────────────────────────────────────────────

    async upsertFacts(scope, userId, facts, embeddings) {
      if (facts.length !== embeddings.length) {
        throw new Error(`fact/embedding count mismatch: ${facts.length} vs ${embeddings.length}`);
      }
      if (facts.length === 0) return { created: 0, updated: 0 };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Read the existing rows for these keys so evidence merges in JS —
        // clearer and easier to test than a jsonb dedupe inside ON CONFLICT.
        const prior = await client.query<FactRow>(
          `SELECT * FROM kb_facts
           WHERE scope=$1 AND user_id=$2 AND fact_key = ANY($3::text[])`,
          [scope, userId, facts.map((f) => f.key)],
        );
        const priorByKey = new Map(prior.rows.map((r) => [`${r.kind} ${r.fact_key}`, rowToFact(r)]));

        let created = 0;
        let updated = 0;
        for (let i = 0; i < facts.length; i++) {
          const f = facts[i] as (typeof facts)[number];
          const emb = embeddings[i] as number[];
          if (emb.length !== KB_EMBED_DIMS) {
            throw new Error(`embedding dims ${emb.length} != ${KB_EMBED_DIMS} for fact ${f.key}`);
          }
          const existing = priorByKey.get(`${f.kind} ${f.key}`);
          const evidence = existing ? mergeEvidence(existing.evidence, f.evidence) : f.evidence.slice(0, EVIDENCE_CAP);
          const firstSeen = Math.min(f.firstSeenMs, existing?.firstSeenMs ?? f.firstSeenMs);
          const lastSeen = Math.max(f.lastSeenMs, existing?.lastSeenMs ?? f.lastSeenMs);

          await client.query(
            `INSERT INTO kb_facts (scope, user_id, kind, subject, statement, detail, fact_key,
                                   confidence, first_seen, last_seen, evidence, embedding, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::halfvec(${KB_EMBED_DIMS}),now())
             ON CONFLICT (scope, user_id, kind, fact_key) DO UPDATE SET
               subject = EXCLUDED.subject, statement = EXCLUDED.statement, detail = EXCLUDED.detail,
               confidence = EXCLUDED.confidence, first_seen = EXCLUDED.first_seen,
               last_seen = EXCLUDED.last_seen, evidence = EXCLUDED.evidence,
               embedding = EXCLUDED.embedding, updated_at = now()`,
            [
              scope,
              userId,
              f.kind,
              f.subject,
              f.statement,
              f.detail ?? null,
              f.key,
              f.confidence,
              new Date(firstSeen).toISOString(),
              new Date(lastSeen).toISOString(),
              JSON.stringify(evidence),
              toVectorLiteral(emb),
            ],
          );
          if (existing) updated++;
          else created++;
        }
        await client.query("COMMIT");
        return { created, updated };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async listFacts(scope, userId, opts) {
      const [rows, kinds] = await Promise.all([
        pool.query<FactRow & { total: string }>(
          `SELECT *, count(*) OVER () AS total FROM kb_facts
           WHERE scope=$1 AND user_id=$2
             AND ($3::text IS NULL OR kind = $3)
             AND ($4::text IS NULL OR subject = $4)
           ORDER BY last_seen DESC
           LIMIT $5 OFFSET $6`,
          [scope, userId, opts.kind ?? null, opts.subject ?? null, opts.limit, opts.offset],
        ),
        pool.query<{ kind: string; count: string }>(
          "SELECT kind, count(*) AS count FROM kb_facts WHERE scope=$1 AND user_id=$2 GROUP BY kind",
          [scope, userId],
        ),
      ]);
      return {
        total: rows.rows[0] ? Number(rows.rows[0].total) : 0,
        items: rows.rows.map(rowToFact),
        kinds: kinds.rows.map((k) => ({ kind: k.kind as KbFactKind, count: Number(k.count) })),
      };
    },

    async searchFacts(q) {
      const res = await pool.query<FactRow>(
        `SELECT * FROM kb_facts
         WHERE scope=$1 AND user_id=$2
         ORDER BY embedding <=> $3::halfvec(${KB_EMBED_DIMS})
         LIMIT $4`,
        [q.scope, q.userId, toVectorLiteral(q.embedding), q.topK],
      );
      return res.rows.map(rowToFact);
    },

    async pendingSynthesis(scope, userId, limit) {
      // Newest first: the most useful knowledge is about what is happening now,
      // and a growing backlog should not delay it.
      const res = await pool.query<ChunkRow>(
        `SELECT id, text, source, source_ref, chunk_seq, ts, permalink, meta, indexed_at
         FROM kb_chunks
         WHERE scope=$1 AND user_id=$2 AND synthesized_at IS NULL
         ORDER BY ts DESC LIMIT $3`,
        [scope, userId, limit],
      );
      return res.rows.map(rowToChunk);
    },

    async markSynthesized(chunkIds) {
      if (chunkIds.length === 0) return;
      await pool.query("UPDATE kb_chunks SET synthesized_at = now() WHERE id = ANY($1::bigint[])", [chunkIds]);
    },

    async pendingSynthesisCount(scope, userId) {
      const res = await pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM kb_chunks WHERE scope=$1 AND user_id=$2 AND synthesized_at IS NULL",
        [scope, userId],
      );
      return Number(res.rows[0]?.n ?? 0);
    },

    // ── Topics ───────────────────────────────────────────────────────────────

    async replaceTopics(scope, userId, topics) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // FK is ON DELETE SET NULL, so this also clears stale assignments.
        await client.query("DELETE FROM kb_topics WHERE scope=$1 AND user_id=$2", [scope, userId]);
        for (const t of topics) {
          const ins = await client.query<{ id: string }>(
            "INSERT INTO kb_topics (scope, user_id, label, summary) VALUES ($1,$2,$3,$4) RETURNING id",
            [scope, userId, t.label, t.summary],
          );
          const topicId = ins.rows[0]?.id;
          if (topicId && t.chunkIds.length > 0) {
            await client.query("UPDATE kb_chunks SET topic_id=$1 WHERE id = ANY($2::bigint[])", [
              topicId,
              t.chunkIds,
            ]);
          }
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async listTopics(scope, userId): Promise<KbTopic[]> {
      const res = await pool.query<{
        id: string;
        scope: string;
        user_id: string;
        label: string;
        summary: string;
        updated_at: Date;
        chunks: string;
        oldest: Date | null;
        newest: Date | null;
      }>(
        `SELECT t.id, t.scope, t.user_id, t.label, t.summary, t.updated_at,
                count(c.id) AS chunks, min(c.ts) AS oldest, max(c.ts) AS newest
         FROM kb_topics t
         LEFT JOIN kb_chunks c ON c.topic_id = t.id
         WHERE t.scope=$1 AND t.user_id=$2
         GROUP BY t.id
         ORDER BY count(c.id) DESC`,
        [scope, userId],
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        scope: r.scope as KbScope,
        userId: r.user_id,
        label: r.label,
        summary: r.summary,
        chunks: Number(r.chunks),
        oldestMs: r.oldest ? r.oldest.getTime() : 0,
        newestMs: r.newest ? r.newest.getTime() : 0,
        updatedAt: r.updated_at.getTime(),
      }));
    },

    async chunksForTopic(scope, userId, topicId, limit) {
      const res = await pool.query<ChunkRow>(
        `SELECT id, text, source, source_ref, chunk_seq, ts, permalink, meta, indexed_at
         FROM kb_chunks
         WHERE scope=$1 AND user_id=$2 AND topic_id=$3::bigint
         ORDER BY ts DESC LIMIT $4`,
        [scope, userId, topicId, limit],
      );
      return res.rows.map(rowToChunk);
    },

    async embeddingsForClustering(scope, userId, limit) {
      const res = await pool.query<{ id: string; text: string; source: string; vec: string }>(
        `SELECT id, text, source, subvector(embedding::vector(${KB_EMBED_DIMS}), 1, ${KB_CLUSTER_DIMS})::text AS vec
         FROM kb_chunks
         WHERE scope=$1 AND user_id=$2
         ORDER BY ts DESC LIMIT $3`,
        [scope, userId, limit],
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        text: r.text,
        source: r.source as KbSource,
        embedding: parseVectorLiteral(r.vec),
      }));
    },

    // ── Activity ─────────────────────────────────────────────────────────────

    async recordCycleEvents(events) {
      if (events.length === 0) return;
      for (const e of events) {
        await pool.query(
          `INSERT INTO kb_cycle_events (cycle_id, at, scope, user_id, source, outcome,
                                        chunks_upserted, api_calls, ms, detail, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            e.cycleId,
            new Date(e.at).toISOString(),
            e.scope,
            e.userId,
            e.source,
            e.outcome,
            e.chunksUpserted,
            e.apiCalls,
            e.ms,
            e.detail ?? null,
            e.error ?? null,
          ],
        );
      }
      await pool.query(`DELETE FROM kb_cycle_events WHERE at < now() - interval '${KB_EVENT_RETENTION_DAYS} days'`);
    },

    async listCycleEvents(userId, limit): Promise<KbCycleEvent[]> {
      const res = await pool.query<{
        id: string;
        cycle_id: string;
        at: Date;
        scope: string;
        user_id: string;
        source: string;
        outcome: string;
        chunks_upserted: number;
        api_calls: number;
        ms: number;
        detail: string | null;
        error: string | null;
      }>(
        `SELECT * FROM kb_cycle_events
         WHERE scope='workspace' OR user_id=$1
         ORDER BY at DESC, id DESC LIMIT $2`,
        [userId, limit],
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        cycleId: r.cycle_id,
        at: r.at.getTime(),
        scope: r.scope as KbScope,
        userId: r.user_id,
        source: r.source as KbCycleEvent["source"],
        outcome: r.outcome as KbCycleEvent["outcome"],
        chunksUpserted: Number(r.chunks_upserted),
        apiCalls: Number(r.api_calls),
        ms: Number(r.ms),
        detail: r.detail ?? undefined,
        error: r.error ?? undefined,
      }));
    },
  };
}
