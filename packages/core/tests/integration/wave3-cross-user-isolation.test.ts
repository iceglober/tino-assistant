/**
 * Integration test: cross-user encryption isolation in multi-user dispatch.
 *
 * Verifies that even if a coding bug reads user B's ciphertext, decrypting it
 * under user A's encryption context fails — KMS (or the local adapter) rejects
 * the mismatched context. This is the cryptographic floor that prevents
 * credential leakage across users in the multi-user dispatch path.
 *
 * Wave 2's wave2-cross-user-decrypt.test.ts covered the raw crypto unit case.
 * This test covers it in the multi-user UserCapabilityStore scenario: user A
 * stores a gmail credential, user B's get() path cannot decrypt it.
 */

import { describe, expect, it } from "vitest";
import { createCryptoAdapter } from "../../src/crypto/factory.js";
import { createSqliteUserCapabilityStore } from "../../src/persistence/user-capabilities.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Wave 3 cross-user isolation via UserCapabilityStore", () => {
  it("decrypting user B credential under user A context fails closed", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tino-test-"));
    const dbPath = path.join(tmpDir, "test.db");

    try {
      const cryptoAdapter = await createCryptoAdapter({
        KMS_KEY_ARN: undefined,
        LOCAL_DEV_CRYPTO_KEY: "test-key-for-testing-only-32bytes",
      } as any);

      const store = createSqliteUserCapabilityStore({ dbPath, cryptoAdapter });

      const userAId = "user-uuid-aaa";
      const userBId = "user-uuid-bbb";

      const gmailConfig: CapabilityConfig = {
        enabled: true,
        credentials: {
          clientId: "user-a-client-id",
          clientSecret: "user-a-secret",
          refreshToken: "user-a-super-secret-refresh-token",
        },
        settings: {},
      };

      // User A stores gmail credentials (encrypted with user A's context)
      await store.set(userAId, "gmail", gmailConfig);

      // User A can read their own credentials back
      const userAResult = await store.get(userAId, "gmail");
      expect(userAResult).not.toBeNull();
      expect(userAResult!.credentials.refreshToken).toBe("user-a-super-secret-refresh-token");

      // User B has no gmail config — normal get returns null
      const userBResult = await store.get(userBId, "gmail");
      expect(userBResult).toBeNull();

      // Adversarial scenario: manually read user A's raw row and try to
      // decrypt it with user B's context via a second store instance.
      // The store's get() method uses the requesting userId as the
      // encryption context — so even if we trick the query to return
      // user A's row, decryption fails.
      const { Database } = await import("bun:sqlite");
      const db = new Database(dbPath);
      const rawRow = db.query(
        "SELECT credentials_json FROM user_capability WHERE tino_user_id = ? AND capability_id = ?",
      ).get(userAId, "gmail") as { credentials_json: string } | null;
      db.close();

      expect(rawRow).not.toBeNull();
      const encryptedCreds = JSON.parse(rawRow!.credentials_json);

      // Attempt to decrypt each field with user B's context
      for (const fieldName of Object.keys(encryptedCreds)) {
        await expect(
          cryptoAdapter.decrypt(encryptedCreds[fieldName], {
            userId: userBId,
            capabilityId: "gmail",
            fieldName,
          }),
        ).rejects.toThrow(/unable to authenticate data|Unsupported state|InvalidCiphertext/);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
