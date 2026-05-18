/**
 * Integration test for cross-user encryption context isolation.
 *
 * Verifies that a user's get path cannot accidentally decrypt another
 * user's credentials — even if a coding bug points GetItem at the wrong
 * partition, the encryption context mismatch causes decryption to fail.
 * This enforces the cryptographic boundary that prevents even a direct
 * ciphertext access from yielding plaintext without the correct context.
 */

import { describe, expect, it } from "vitest";
import { createCryptoAdapter } from "../../src/crypto/factory.js";
import type { EncryptionContext } from "../../src/crypto/types.js";

describe("Cross-user decrypt isolation", () => {
  it("fails to decrypt user A's credentials with user B's encryption context", async () => {
    const cryptoAdapter = await createCryptoAdapter({
      KMS_KEY_ARN: undefined,
      LOCAL_DEV_CRYPTO_KEY: "test-key-for-testing-only-32bytes",
    } as any);

    // User A encrypts a refresh token
    const userAId = "user-uuid-aaa";
    const userBId = "user-uuid-bbb";
    const capabilityId = "gmail";
    const fieldName = "refreshToken";
    const plaintext = "user-a-refresh-token-secret";

    const contextA: EncryptionContext = {
      userId: userAId,
      capabilityId,
      fieldName,
    };

    const envelopeA = await cryptoAdapter.encrypt(plaintext, contextA);

    // User B attempts to decrypt with their own context
    // (simulating a bug that loads user A's ciphertext)
    const contextB: EncryptionContext = {
      userId: userBId,
      capabilityId,
      fieldName,
    };

    // The mismatched userId in the encryption context should cause
    // the auth-tag verification to fail (local adapter) or KMS to reject
    // (KMS adapter). Both paths reject with an authentication error.
    await expect(cryptoAdapter.decrypt(envelopeA, contextB)).rejects.toThrow(
      /unable to authenticate data|Unsupported state|InvalidCiphertext/,
    );
  });

  it("fails to decrypt with mismatched capabilityId even if userId matches", async () => {
    const cryptoAdapter = await createCryptoAdapter({
      KMS_KEY_ARN: undefined,
      LOCAL_DEV_CRYPTO_KEY: "test-key-for-testing-only-32bytes",
    } as any);

    const userId = "user-uuid-123";
    const plaintext = "secret-token";

    // Encrypt with gmail capability
    const contextGmail: EncryptionContext = {
      userId,
      capabilityId: "gmail",
      fieldName: "refreshToken",
    };

    const envelope = await cryptoAdapter.encrypt(plaintext, contextGmail);

    // Attempt decrypt with slack capability (same user, different capability)
    const contextSlack: EncryptionContext = {
      userId,
      capabilityId: "slack-personal",
      fieldName: "refreshToken",
    };

    await expect(cryptoAdapter.decrypt(envelope, contextSlack)).rejects.toThrow(
      /unable to authenticate data|Unsupported state|InvalidCiphertext/,
    );
  });

  it("succeeds with matching context on both sides of encrypt/decrypt", async () => {
    const cryptoAdapter = await createCryptoAdapter({
      KMS_KEY_ARN: undefined,
      LOCAL_DEV_CRYPTO_KEY: "test-key-for-testing-only-32bytes",
    } as any);

    const userId = "user-uuid-consistent";
    const capabilityId = "gmail";
    const fieldName = "refreshToken";
    const plaintext = "valid-refresh-token";

    const context: EncryptionContext = {
      userId,
      capabilityId,
      fieldName,
    };

    const envelope = await cryptoAdapter.encrypt(plaintext, context);
    const decrypted = await cryptoAdapter.decrypt(envelope, context);

    expect(decrypted).toBe(plaintext);
  });
});
