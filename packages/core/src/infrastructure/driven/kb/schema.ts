/**
 * KB tables — ensure-DDL-on-boot, same philosophy as the core postgres schema.
 * Requires pgvector ≥ 0.7 (halfvec): embeddings are full-dimensionality 3072
 * from gemini-embedding-001, stored fp16 because pgvector's fp32 `vector` HNSW
 * index caps at 2000 dims while halfvec indexes up to ~4000. HNSW over IVFFlat
 * because the table starts empty and grows incrementally.
 *
 * Returns false (KB disabled) when pgvector/halfvec is unavailable.
 */
import type { Logger } from "../../../ports/outbound.js";
import type { PgPool } from "../persistence/postgres/client.js";

export const KB_EMBED_DIMS = 3072;
export const KB_EMBED_MODEL = "gemini-embedding-001@3072h";

const DDL = `
CREATE TABLE IF NOT EXISTS kb_chunks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope        TEXT        NOT NULL CHECK (scope IN ('workspace','user')),
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
`;

/** Create KB tables. Returns true when the KB is usable (pgvector+halfvec present). */
export async function ensureKbSchema(pool: PgPool, logger: Logger): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [0x74696b62]); // "tikb"
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(DDL);
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
