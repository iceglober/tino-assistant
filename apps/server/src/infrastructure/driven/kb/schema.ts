/**
 * Knowledge-base tables, created by the core schema step. Requires pgvector
 * ≥ 0.7 (halfvec): embeddings are 3072-dimensional, stored fp16 because
 * pgvector's fp32 `vector` HNSW index caps at 2000 dims while halfvec indexes
 * up to ~4000. HNSW over IVFFlat because tables start empty and grow.
 *
 * Every table carries `org_id`, first in every unique key. Within an org,
 * `scope='workspace'` rows (user_id '') are what the whole company can see and
 * `scope='private'` rows belong to one person.
 *
 * Three layers:
 *   kb_chunks   raw indexed text (what was said)
 *   kb_facts    distilled claims with evidence (what tino knows)
 *   kb_topics   labelled clusters of chunks (themes)
 * plus kb_cursors / kb_index_state / kb_cycle_events for the indexer itself.
 */

export const KB_EMBED_DIMS = 3072;
/** Activity rows are a debugging aid, not a record — keep a week. */
export const KB_EVENT_RETENTION_DAYS = 7;

export const KB_DDL = `
CREATE TABLE IF NOT EXISTS kb_topics (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     TEXT        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  scope      TEXT        NOT NULL,
  user_id    TEXT        NOT NULL DEFAULT '',
  label      TEXT        NOT NULL,
  summary    TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_topics_scope_user ON kb_topics (org_id, scope, user_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         TEXT        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  scope          TEXT        NOT NULL CHECK (scope IN ('workspace','private')),
  user_id        TEXT        NOT NULL DEFAULT '',
  source         TEXT        NOT NULL CHECK (source IN ('slack_channel','slack_thread','slack_dm','gmail')),
  source_ref     TEXT        NOT NULL,
  chunk_seq      INT         NOT NULL DEFAULT 0,
  text           TEXT        NOT NULL,
  embedding      halfvec(${KB_EMBED_DIMS}) NOT NULL,
  embed_model    TEXT        NOT NULL,
  ts             TIMESTAMPTZ NOT NULL,
  permalink      TEXT,
  meta           JSONB       NOT NULL DEFAULT '{}',
  content_hash   TEXT        NOT NULL,
  indexed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  synthesized_at TIMESTAMPTZ,
  -- Topics are rebuilt wholesale; chunks must survive their cluster being dropped.
  topic_id       BIGINT REFERENCES kb_topics (id) ON DELETE SET NULL,
  UNIQUE (org_id, scope, user_id, source, source_ref, chunk_seq)
);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
  ON kb_chunks USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS kb_chunks_scope_user_ts ON kb_chunks (org_id, scope, user_id, ts DESC);
CREATE INDEX IF NOT EXISTS kb_chunks_pending_synthesis
  ON kb_chunks (org_id, scope, user_id, ts) WHERE synthesized_at IS NULL;
CREATE INDEX IF NOT EXISTS kb_chunks_topic ON kb_chunks (topic_id) WHERE topic_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kb_cursors (
  org_id     TEXT  NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  scope      TEXT  NOT NULL,
  user_id    TEXT  NOT NULL DEFAULT '',
  source     TEXT  NOT NULL,
  stream     TEXT  NOT NULL,
  state      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, scope, user_id, source, stream)
);

CREATE TABLE IF NOT EXISTS kb_index_state (
  org_id        TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  user_id       TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused_auth','paused_error','disabled')),
  backfill_done BOOLEAN NOT NULL DEFAULT false,
  last_cycle_at TIMESTAMPTZ,
  paused_at     TIMESTAMPTZ,
  last_error    TEXT,
  PRIMARY KEY (org_id, scope, user_id, source)
);

-- Distilled knowledge. Merge identity is (org,scope,user_id,kind,fact_key) so
-- re-observing a claim extends it instead of duplicating it.
CREATE TABLE IF NOT EXISTS kb_facts (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     TEXT        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
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
  UNIQUE (org_id, scope, user_id, kind, fact_key)
);
CREATE INDEX IF NOT EXISTS kb_facts_embedding_hnsw
  ON kb_facts USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS kb_facts_scope_user ON kb_facts (org_id, scope, user_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS kb_cycle_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          TEXT        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS kb_cycle_events_principal ON kb_cycle_events (org_id, scope, user_id, at DESC);
`;
