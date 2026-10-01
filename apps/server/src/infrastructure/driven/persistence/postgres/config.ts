/**
 * Org-bound ConfigStore. Values are JSON strings and `get` returns exactly what
 * was stored — except that secret keys (`isSecretConfigKey`: client secrets,
 * tokens, API keys) are envelope-encrypted at rest with the org and key bound
 * as AAD, and decrypted on read. Readers inside the server see plaintext; the
 * HTTP layer is what keeps secrets write-only.
 */
import { isSecretConfigKey, orgOwnerId } from "@tino/core/domain/org";
import type { ConfigStore, CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "@tino/core/ports/outbound";
import type { PgPool } from "../db.js";

interface Row {
  key: string;
  value: string;
  is_secret: boolean;
  updated_at: string;
}

export function createPgConfigStore({
  pool,
  orgId,
  cryptoAdapter,
}: {
  pool: PgPool;
  orgId: string;
  cryptoAdapter: CryptoAdapter;
}): ConfigStore {
  const context = (key: string): EncryptionContext => ({
    userId: orgOwnerId(orgId),
    capabilityId: "config",
    fieldName: key,
  });

  const reveal = async (row: Row): Promise<string> =>
    row.is_secret ? cryptoAdapter.decrypt(JSON.parse(row.value) as EnvelopeCiphertext, context(row.key)) : row.value;

  const read = async (key: string): Promise<string | null> => {
    const res = await pool.query<Row>("SELECT * FROM org_config WHERE org_id = $1 AND key = $2", [orgId, key]);
    return res.rows[0] ? reveal(res.rows[0]) : null;
  };

  return {
    get: read,

    async getTyped<T>(key: string, fallback: T): Promise<T> {
      const raw = await read(key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      const json = JSON.stringify(value);
      const secret = isSecretConfigKey(key);
      const stored = secret ? JSON.stringify(await cryptoAdapter.encrypt(json, context(key))) : json;
      await pool.query(
        `INSERT INTO org_config (org_id, key, value, is_secret, updated_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, key) DO UPDATE SET
           value = EXCLUDED.value, is_secret = EXCLUDED.is_secret, updated_at = EXCLUDED.updated_at`,
        [orgId, key, stored, secret, Date.now()],
      );
    },

    async list(): Promise<Array<{ key: string; value: string; updatedAt: number }>> {
      const res = await pool.query<Row>("SELECT * FROM org_config WHERE org_id = $1 ORDER BY key", [orgId]);
      return Promise.all(
        res.rows.map(async (row) => ({ key: row.key, value: await reveal(row), updatedAt: Number(row.updated_at) })),
      );
    },

    async delete(key: string): Promise<boolean> {
      const res = await pool.query("DELETE FROM org_config WHERE org_id = $1 AND key = $2", [orgId, key]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}
