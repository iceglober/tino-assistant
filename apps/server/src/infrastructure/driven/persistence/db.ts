/**
 * The one database handle the process uses. Always Postgres — real Postgres
 * (Railway, any provider with pgvector ≥ 0.7) when DATABASE_URL is set, or
 * PGlite, an in-process WASM Postgres with pgvector, for local dev and tests.
 * Same SQL dialect either way, so there is one adapter per store, not two.
 *
 * PGlite is exposed through the slice of the `pg.Pool` interface the stores
 * and better-auth (via kysely) actually use: `query`, `connect` → client with
 * `query`/`release`, and `end`. It has a single session, so `connect` hands
 * out exclusive use of it until `release` — otherwise two transactions would
 * interleave on one connection.
 */
import pg from "pg";

export type PgPool = pg.Pool;

export async function createDb(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<PgPool> {
  if (opts.databaseUrl) {
    return new pg.Pool({
      connectionString: opts.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return createPglitePool(opts.pgliteDir);
}

/**
 * A pg.Pool-shaped PGlite. `dataDir` undefined = in-memory (tests); a path =
 * persisted to disk (local dev).
 */
export async function createPglitePool(dataDir?: string): Promise<PgPool> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const db = await PGlite.create({ dataDir, extensions: { vector } });

  // A FIFO lock over the single session.
  let tail: Promise<void> = Promise.resolve();
  const acquire = async (): Promise<() => void> => {
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const prev = tail;
    tail = prev.then(() => held);
    await prev;
    return release;
  };

  const run = async (text: string, params?: unknown[]) => {
    // Like pg, a query without parameters goes through the simple protocol,
    // which allows several statements (the schema DDL); the last result wins.
    if (!params || params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1];
      const rows = (last?.rows ?? []) as Record<string, unknown>[];
      return {
        rows,
        rowCount: last?.affectedRows ?? rows.length,
        command: commandOf(text),
        fields: last?.fields ?? [],
      };
    }
    const res = await db.query<Record<string, unknown>>(text, params);
    const rowCount = res.affectedRows ?? res.rows.length;
    return { rows: res.rows, rowCount, command: commandOf(text), fields: res.fields };
  };

  const pool = {
    async query(text: string | { text: string; values?: unknown[] }, params?: unknown[]) {
      const release = await acquire();
      try {
        return typeof text === "string" ? await run(text, params) : await run(text.text, text.values);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      let released = false;
      return {
        query: (text: string | { text: string; values?: unknown[] }, params?: unknown[]) =>
          typeof text === "string" ? run(text, params) : run(text.text, text.values),
        release: () => {
          if (!released) {
            released = true;
            release();
          }
        },
      };
    },
    async end() {
      await db.close();
    },
    on() {
      return pool;
    },
  };
  return pool as unknown as PgPool;
}

/** kysely reads `command` to report affected rows for writes. */
function commandOf(sql: string): string {
  const m = /^\s*(?:with\b[\s\S]*?\)\s*)?(\w+)/i.exec(sql);
  return (m?.[1] ?? "").toUpperCase();
}
