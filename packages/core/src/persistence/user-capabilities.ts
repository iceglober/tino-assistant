import { Database } from "bun:sqlite";

import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "../crypto/types.js";
import type { CapabilityConfig } from "../capabilities/types.js";

/**
 * Per-user capability store with encrypted credentials.
 *
 * - get(userId, capabilityId) returns plaintext CapabilityConfig
 * - set(userId, capabilityId, config) encrypts credentials before storing
 * - list(userId) returns enabled flags only (no decryption)
 * - delete(userId, capabilityId) removes the record; returns true if existed
 *
 * Different (userId, capabilityId) partitions are fully isolated.
 * Credentials are encrypted per-field with userId+capabilityId+fieldName context.
 */
export interface UserCapabilityStore {
  get(userId: string, capabilityId: string): Promise<CapabilityConfig | null>;
  set(userId: string, capabilityId: string, config: CapabilityConfig): Promise<void>;
  list(userId: string): Promise<Array<{ capabilityId: string; enabled: boolean }>>;
  delete(userId: string, capabilityId: string): Promise<boolean>;
}

/**
 * SQLite-backed UserCapabilityStore.
 *
 * Schema: user_capability(tino_user_id, capability_id, enabled, credentials_json, settings_json, updated_at)
 * credentials_json is a JSON object whose keys are credential field names and
 * whose values are serialized EnvelopeCiphertext records (encrypted with context).
 */
export function createSqliteUserCapabilityStore({
  dbPath,
  cryptoAdapter,
}: {
  dbPath: string;
  cryptoAdapter: CryptoAdapter;
}): UserCapabilityStore {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_capability (
      tino_user_id   TEXT    NOT NULL,
      capability_id  TEXT    NOT NULL,
      enabled        INTEGER NOT NULL,
      credentials_json TEXT,
      settings_json  TEXT,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (tino_user_id, capability_id)
    )
  `);

  const stmtGet = db.query(
    "SELECT enabled, credentials_json, settings_json FROM user_capability WHERE tino_user_id = ? AND capability_id = ?",
  );

  const stmtUpsert = db.query(
    `INSERT INTO user_capability (tino_user_id, capability_id, enabled, credentials_json, settings_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tino_user_id, capability_id) DO UPDATE SET
       enabled = excluded.enabled,
       credentials_json = excluded.credentials_json,
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`,
  );

  const stmtList = db.query(
    "SELECT capability_id, enabled FROM user_capability WHERE tino_user_id = ? ORDER BY capability_id",
  );

  const stmtDelete = db.query("DELETE FROM user_capability WHERE tino_user_id = ? AND capability_id = ?");

  const stmtExists = db.query("SELECT 1 FROM user_capability WHERE tino_user_id = ? AND capability_id = ?");

  async function encryptCredentials(
    credentials: Record<string, string>,
    userId: string,
    capabilityId: string,
  ): Promise<Record<string, EnvelopeCiphertext>> {
    const encrypted: Record<string, EnvelopeCiphertext> = {};
    for (const [key, value] of Object.entries(credentials)) {
      const context: EncryptionContext = { userId, capabilityId, fieldName: key };
      encrypted[key] = await cryptoAdapter.encrypt(value, context);
    }
    return encrypted;
  }

  async function decryptCredentials(
    encryptedRecord: Record<string, EnvelopeCiphertext>,
    userId: string,
    capabilityId: string,
  ): Promise<Record<string, string>> {
    const decrypted: Record<string, string> = {};
    for (const [key, envelope] of Object.entries(encryptedRecord)) {
      const context: EncryptionContext = { userId, capabilityId, fieldName: key };
      decrypted[key] = await cryptoAdapter.decrypt(envelope, context);
    }
    return decrypted;
  }

  return {
    async get(userId: string, capabilityId: string): Promise<CapabilityConfig | null> {
      const row = stmtGet.get(userId, capabilityId) as
        | { enabled: number; credentials_json?: string; settings_json?: string }
        | null;

      if (!row) return null;

      const encryptedCredentials = row.credentials_json ? JSON.parse(row.credentials_json) : {};
      const settings = row.settings_json ? JSON.parse(row.settings_json) : {};

      const credentials = await decryptCredentials(encryptedCredentials, userId, capabilityId);

      return {
        enabled: row.enabled === 1,
        credentials,
        settings,
      };
    },

    async set(userId: string, capabilityId: string, config: CapabilityConfig): Promise<void> {
      const encryptedCredentials = await encryptCredentials(config.credentials, userId, capabilityId);
      const credentialsJson = JSON.stringify(encryptedCredentials);
      const settingsJson = JSON.stringify(config.settings);

      stmtUpsert.run(userId, capabilityId, config.enabled ? 1 : 0, credentialsJson, settingsJson, Date.now());
    },

    async list(userId: string): Promise<Array<{ capabilityId: string; enabled: boolean }>> {
      return Promise.resolve(
        (stmtList.all(userId) as Array<{ capability_id: string; enabled: number }>).map((row) => ({
          capabilityId: row.capability_id,
          enabled: row.enabled === 1,
        })),
      );
    },

    async delete(userId: string, capabilityId: string): Promise<boolean> {
      const exists = stmtExists.get(userId, capabilityId);
      if (!exists) return false;

      stmtDelete.run(userId, capabilityId);
      return true;
    },
  };
}
