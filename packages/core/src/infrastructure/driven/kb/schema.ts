/**
 * KB tables — ensure-DDL-on-boot, same philosophy as the core postgres schema.
 * Requires pgvector ≥ 0.7 (halfvec): embeddings are full-dimensionality 3072
 * from gemini-embedding-001, stored fp16 because pgvector's fp32 `vector` HNSW
 * index caps at 2000 dims while halfvec indexes up to ~4000. HNSW over IVFFlat
 * because the tables start empty and grow incrementally.
 *
 * Three layers live here:
 *   kb_chunks   raw indexed text (what was said)
 *   kb_facts    distilled claims with evidence (what tino knows)
 *   kb_topics   labelled clusters of chunks (themes)
 * plus kb_cursors / kb_index_state / kb_cycle_events for the indexer itself.
 *
 * Returns false (KB disabled) when pgvector/halfvec is unavailable.
 */
import type { Logger } from "../../../ports/outbound.js";
import type { PgPool } from "../persistence/postgres/client.js";

export const KB_EMBED_DIMS = 3072;
export const KB_EMBED_MODEL = "gemini-embedding-001@3072h";
/** Activity rows are a debugging aid, not a record — keep a week. */
export const KB_EVENT_RETENTION_DAYS = 7;

const DDL = `
CREATE TABLE IF NOT EXISTS kb_chunks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope        TEXT        NOT NULL,
  user_id      TEXT        NOT NULL DEFAULT '',
  source       TEXT        NOT NULL CHECK (source IN ('slack_channel','slack_thread','slack_dm','gmail')),
  source_ref   TEXT        NOT NULL,
  chunk_seq    INT         NOT NULL DEFAULT 0,
  text         TEXT        NOT NULL,
  embedding    halfvec(${KB_EMBED_DIMS}) NOT NULL,
  embed_model  TEXT        NOT NULL,
  ts           TIMESTAMPTZ NOT NULL,
  permalink    TEXT,
  meta         JSONB       NOT NULL DEFAULT '{}',
  content_hash TEXT        NOT NULL,
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, user_id, source, source_ref, chunk_seq)
);

CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
  ON kb_chunks USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS kb_chunks_scope_user_ts ON kb_chunks (scope, user_id, ts DESC);

CREATE TABLE IF NOT EXISTS kb_cursors (
  scope      TEXT NOT NULL,
  user_id    TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL,
  stream     TEXT NOT NULL,
  state      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, user_id, source, stream)
);

CREATE TABLE IF NOT EXISTS kb_index_state (
  scope         TEXT NOT NULL,
  user_id       TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused_auth','paused_error','disabled')),
  backfill_done BOOLEAN NOT NULL DEFAULT false,
  last_cycle_at TIMESTAMPTZ,
  paused_at     TIMESTAMPTZ,
  last_error    TEXT,
  PRIMARY KEY (scope, user_id, source)
);

-- Distilled knowledge. Merge identity is (scope,user_id,kind,fact_key) so
-- re-observing a claim extends it instead of duplicating it.
CREATE TABLE IF NOT EXISTS kb_facts (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope      TEXT        NOT NULL,
  user_id    TEXT        NOT NULL DEFAULT '',
  kind       TEXT        NOT NULL,
  subject    TEXT        NOT NULL,
  statement  TEXT        NOT NULL,
  detail     TEXT,
  fact_key   TEXT        NOT NULL,
  confidence REAL        NOT NULL DEFAULT 0.5,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen  TIMESTAMPTZ NOT NULL,
  evidence   JSONB       NOT NULL DEFAULT '[]',
  embedding  halfvec(${KB_EMBED_DIMS}) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, user_id, kind, fact_key)
);

CREATE INDEX IF NOT EXISTS kb_facts_embedding_hnsw
  ON kb_facts USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS kb_facts_scope_user ON kb_facts (scope, user_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS kb_topics (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope      TEXT        NOT NULL,
  user_id    TEXT        NOT NULL DEFAULT '',
  label      TEXT        NOT NULL,
  summary    TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_topics_scope_user ON kb_topics (scope, user_id);

CREATE TABLE IF NOT EXISTS kb_cycle_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cycle_id        TEXT        NOT NULL,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope           TEXT        NOT NULL,
  user_id         TEXT        NOT NULL DEFAULT '',
  source          TEXT        NOT NULL,
  outcome         TEXT        NOT NULL,
  chunks_upserted INT         NOT NULL DEFAULT 0,
  api_calls       INT         NOT NULL DEFAULT 0,
  ms              INT         NOT NULL DEFAULT 0,
  detail          TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS kb_cycle_events_at ON kb_cycle_events (at DESC);
CREATE INDEX IF NOT EXISTS kb_cycle_events_principal ON kb_cycle_events (scope, user_id, at DESC);
`;

/**
 * Idempotent migrations applied after the DDL. Ordered: add the columns the
 * newer code reads, rename the scope vocabulary, then re-assert the CHECK.
 * `scope='user'` predates the private/workspace rename (2026-07-25).
 */
const MIGRATIONS = `
ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS synthesized_at TIMESTAMPTZ;
ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS topic_id BIGINT;

CREATE INDEX IF NOT EXISTS kb_chunks_pending_synthesis
  ON kb_chunks (scope, user_id, ts) WHERE synthesized_at IS NULL;
CREATE INDEX IF NOT EXISTS kb_chunks_topic ON kb_chunks (topic_id) WHERE topic_id IS NOT NULL;

ALTER TABLE kb_chunks DROP CONSTRAINT IF EXISTS kb_chunks_scope_check;
UPDATE kb_chunks      SET scope = 'private' WHERE scope = 'user';
UPDATE kb_cursors     SET scope = 'private' WHERE scope = 'user';
UPDATE kb_index_state SET scope = 'private' WHERE scope = 'user';
ALTER TABLE kb_chunks ADD CONSTRAINT kb_chunks_scope_check CHECK (scope IN ('workspace','private'));

-- Topics are rebuilt wholesale; chunks must survive their cluster being dropped.
ALTER TABLE kb_chunks DROP CONSTRAINT IF EXISTS kb_chunks_topic_fk;
ALTER TABLE kb_chunks ADD CONSTRAINT kb_chunks_topic_fk
  FOREIGN KEY (topic_id) REFERENCES kb_topics (id) ON DELETE SET NULL;

DELETE FROM kb_cycle_events WHERE at < now() - interval '${KB_EVENT_RETENTION_DAYS} days';
`;

/** Create/upgrade KB tables. Returns true when the KB is usable. */
export async function ensureKbSchema(pool: PgPool, logger: Logger): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [0x74696b62]); // "tikb"
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(DDL);
      await client.query(MIGRATIONS);
      logger.info("kb schema ensured");
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "kb schema unavailable (pgvector>=0.7 required) — KB disabled");
      return false;
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [0x74696b62]).catch(() => {});
    client.release();
  }
}
