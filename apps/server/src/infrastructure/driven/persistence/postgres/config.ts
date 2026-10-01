/**
 * Postgres-backed ConfigStore — contract-identical to the sqlite version:
 * values are raw JSON strings, `get` returns exactly what was stored.
 */
import type { ConfigStore } from "@tino/core/ports/outbound";
import type { PgPool } from "./client.js";

export function createPgConfigStore({ pool }: { pool: PgPool }): ConfigStore {
  return {
    async get(key: string): Promise<string | null> {
      const res = await pool.query<{ value: string }>("SELECT value FROM config WHERE key = $1", [key]);
      return res.rows[0]?.value ?? null;
    },

    async getTyped<T>(key: string, fallback: T): Promise<T> {
      const res = await pool.query<{ value: string }>("SELECT value FROM config WHERE key = $1", [key]);
      const raw = res.rows[0]?.value;
      if (raw === undefined) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      await pool.query(
        `INSERT INTO config (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(value), Date.now()],
      );
    },

    async list(): Promise<Array<{ key: string; value: string; updatedAt: number }>> {
      const res = await pool.query<{ key: string; value: string; updated_at: string }>(
        "SELECT key, value, updated_at FROM config ORDER BY key",
      );
      return res.rows.map((row) => ({ key: row.key, value: row.value, updatedAt: Number(row.updated_at) }));
    },

    async delete(key: string): Promise<boolean> {
      const res = await pool.query("DELETE FROM config WHERE key = $1", [key]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}
