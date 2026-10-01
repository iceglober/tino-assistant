/**
 * Org-bound UserCapabilityStore. Credentials are envelope-encrypted
 * per-field via the shared codec; the encrypted record is JSONB (base64-only
 * payloads, so JSONB-safe). pg parses JSONB columns to objects on read.
 */
import type { CapabilityConfig } from "@tino/core/domain/types";
import type { CryptoAdapter, EnvelopeCiphertext, UserCapabilityStore } from "@tino/core/ports/outbound";
import { decryptCredentials, encryptCredentials } from "../credentials-codec.js";
import type { PgPool } from "../db.js";

interface CapRow {
  enabled: boolean;
  credentials_json: Record<string, EnvelopeCiphertext> | null;
  settings_json: Record<string, unknown> | null;
}

export function createPgUserCapabilityStore({
  pool,
  orgId,
  cryptoAdapter,
}: {
  pool: PgPool;
  orgId: string;
  cryptoAdapter: CryptoAdapter;
}): UserCapabilityStore {
  return {
    async get(userId: string, capabilityId: string): Promise<CapabilityConfig | null> {
      const res = await pool.query<CapRow>(
        "SELECT enabled, credentials_json, settings_json FROM user_capability WHERE tino_user_id = $1 AND capability_id = $2 AND org_id = $3",
        [userId, capabilityId, orgId],
      );
      const row = res.rows[0];
      if (!row) return null;

      const credentials = await decryptCredentials(cryptoAdapter, row.credentials_json ?? {}, userId, capabilityId);
      return { enabled: row.enabled, credentials, settings: row.settings_json ?? {} };
    },

    async set(userId: string, capabilityId: string, config: CapabilityConfig): Promise<void> {
      const encrypted = await encryptCredentials(cryptoAdapter, config.credentials, userId, capabilityId);
      await pool.query(
        `INSERT INTO user_capability (tino_user_id, capability_id, enabled, credentials_json, settings_json, updated_at, org_id)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
         ON CONFLICT (org_id, tino_user_id, capability_id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           credentials_json = EXCLUDED.credentials_json,
           settings_json = EXCLUDED.settings_json,
           updated_at = EXCLUDED.updated_at`,
        [userId, capabilityId, config.enabled, JSON.stringify(encrypted), JSON.stringify(config.settings), Date.now(), orgId],
      );
    },

    async list(userId: string): Promise<Array<{ capabilityId: string; enabled: boolean }>> {
      const res = await pool.query<{ capability_id: string; enabled: boolean }>(
        "SELECT capability_id, enabled FROM user_capability WHERE tino_user_id = $1 AND org_id = $2 ORDER BY capability_id",
        [userId, orgId],
      );
      return res.rows.map((row) => ({ capabilityId: row.capability_id, enabled: row.enabled }));
    },

    async delete(userId: string, capabilityId: string): Promise<boolean> {
      const res = await pool.query("DELETE FROM user_capability WHERE tino_user_id = $1 AND capability_id = $2 AND org_id = $3",
        [userId, capabilityId, orgId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
