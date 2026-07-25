/**
 * Postgres-backed UserCapabilityStore. Credentials are envelope-encrypted
 * per-field via the shared codec; the encrypted record is JSONB (base64-only
 * payloads, so JSONB-safe). pg parses JSONB columns to objects on read.
 */
import type { CapabilityConfig } from "../../../../domain/types.js";
import type { CryptoAdapter, EnvelopeCiphertext, UserCapabilityStore } from "../../../../ports/outbound.js";
import { decryptCredentials, encryptCredentials } from "../credentials-codec.js";
import type { PgPool } from "./client.js";

interface CapRow {
  enabled: boolean;
  credentials_json: Record<string, EnvelopeCiphertext> | null;
  settings_json: Record<string, unknown> | null;
}

export function createPgUserCapabilityStore({
  pool,
  cryptoAdapter,
}: {
  pool: PgPool;
  cryptoAdapter: CryptoAdapter;
}): UserCapabilityStore {
  return {
    async get(userId: string, capabilityId: string): Promise<CapabilityConfig | null> {
      const res = await pool.query<CapRow>(
        "SELECT enabled, credentials_json, settings_json FROM user_capability WHERE tino_user_id = $1 AND capability_id = $2",
        [userId, capabilityId],
      );
      const row = res.rows[0];
      if (!row) return null;

      const credentials = await decryptCredentials(cryptoAdapter, row.credentials_json ?? {}, userId, capabilityId);
      return { enabled: row.enabled, credentials, settings: row.settings_json ?? {} };
    },

    async set(userId: string, capabilityId: string, config: CapabilityConfig): Promise<void> {
      const encrypted = await encryptCredentials(cryptoAdapter, config.credentials, userId, capabilityId);
      await pool.query(
        `INSERT INTO user_capability (tino_user_id, capability_id, enabled, credentials_json, settings_json, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         ON CONFLICT (tino_user_id, capability_id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           credentials_json = EXCLUDED.credentials_json,
           settings_json = EXCLUDED.settings_json,
           updated_at = EXCLUDED.updated_at`,
        [userId, capabilityId, config.enabled, JSON.stringify(encrypted), JSON.stringify(config.settings), Date.now()],
      );
    },

    async list(userId: string): Promise<Array<{ capabilityId: string; enabled: boolean }>> {
      const res = await pool.query<{ capability_id: string; enabled: boolean }>(
        "SELECT capability_id, enabled FROM user_capability WHERE tino_user_id = $1 ORDER BY capability_id",
        [userId],
      );
      return res.rows.map((row) => ({ capabilityId: row.capability_id, enabled: row.enabled }));
    },

    async delete(userId: string, capabilityId: string): Promise<boolean> {
      const res = await pool.query("DELETE FROM user_capability WHERE tino_user_id = $1 AND capability_id = $2", [
        userId,
        capabilityId,
      ]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}
