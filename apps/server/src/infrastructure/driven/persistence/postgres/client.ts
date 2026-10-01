/**
 * Shared pg Pool for the Postgres persistence adapters. One pool per process;
 * Cloud SQL connects over its unix socket:
 *   postgresql://tino:PW@/tino?host=/cloudsql/PROJECT:REGION:INSTANCE
 * Local dev (docker-compose pgvector): postgres://tino:tino@localhost:5432/tino
 */
import pg from "pg";

export type PgPool = pg.Pool;

export function createPgPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
