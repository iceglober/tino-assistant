import { describe, it, expect } from "vitest";

import { LocalAdapter } from "../../src/crypto/local-adapter.js";
import type { EncryptionContext } from "../../src/crypto/types.js";

describe("LocalAdapter", () => {
  const testContext: EncryptionContext = {
    userId: "user-123",
    capabilityId: "gmail",
    fieldName: "refreshToken",
  };

  it("encrypts and decrypts with same context to recover plaintext", async () => {
    const adapter = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "test-key" });
    const plaintext = "secret-refresh-token-xyz";

    const envelope = await adapter.encrypt(plaintext, testContext);

    expect(envelope.algorithm).toBe("AES-256-GCM/v1");
    expect(envelope.ciphertext).toBeDefined();
    expect(envelope.authTag).toBeDefined();
    expect(envelope.iv).toBeDefined();
    expect(envelope.encryptedDataKey).toBeUndefined(); // Local adapter omits this

    const decrypted = await adapter.decrypt(envelope, testContext);
    expect(decrypted).toBe(plaintext);
  });

  it("fails to decrypt with mismatched userId context", async () => {
    const adapter = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "test-key" });
    const plaintext = "secret-token";
    const envelope = await adapter.encrypt(plaintext, testContext);

    const wrongContext: EncryptionContext = {
      ...testContext,
      userId: "different-user",
    };

    await expect(adapter.decrypt(envelope, wrongContext)).rejects.toThrow(
      /unable to authenticate data|Unsupported state/,
    );
  });

  it("fails to decrypt with mismatched capabilityId context", async () => {
    const adapter = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "test-key" });
    const plaintext = "secret-token";
    const envelope = await adapter.encrypt(plaintext, testContext);

    const wrongContext: EncryptionContext = {
      ...testContext,
      capabilityId: "slack",
    };

    await expect(adapter.decrypt(envelope, wrongContext)).rejects.toThrow(
      /unable to authenticate data|Unsupported state/,
    );
  });

  it("fails to decrypt with mismatched fieldName context", async () => {
    const adapter = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "test-key" });
    const plaintext = "secret-token";
    const envelope = await adapter.encrypt(plaintext, testContext);

    const wrongContext: EncryptionContext = {
      ...testContext,
      fieldName: "accessToken",
    };

    await expect(adapter.decrypt(envelope, wrongContext)).rejects.toThrow(
      /unable to authenticate data|Unsupported state/,
    );
  });

  it("produces all required envelope fields", async () => {
    const adapter = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "test-key" });
    const envelope = await adapter.encrypt("plaintext", testContext);

    // Verify all fields are present and valid base64
    expect(envelope.algorithm).toBe("AES-256-GCM/v1");
    expect(Buffer.from(envelope.ciphertext, "base64")).toBeInstanceOf(Buffer);
    expect(Buffer.from(envelope.authTag, "base64")).toHaveLength(16); // 16-byte auth tag
    expect(Buffer.from(envelope.iv, "base64")).toHaveLength(12); // 12-byte IV
    expect(envelope.encryptedDataKey).toBeUndefined();
  });

  it("uses random IV each encryption (different ciphertexts for same plaintext)", async () => {
    const adapter = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "test-key" });
    const plaintext = "same-plaintext";

    const envelope1 = await adapter.encrypt(plaintext, testContext);
    const envelope2 = await adapter.encrypt(plaintext, testContext);

    // Same plaintext should produce different ciphertexts due to random IV
    expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
    expect(envelope1.iv).not.toBe(envelope2.iv);
  });

  it("derives consistent key from same password", async () => {
    const adapter1 = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "consistent-key" });
    const adapter2 = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "consistent-key" });

    const plaintext = "test-value";
    const envelope = await adapter1.encrypt(plaintext, testContext);

    // Second adapter with same password should decrypt successfully
    const decrypted = await adapter2.decrypt(envelope, testContext);
    expect(decrypted).toBe(plaintext);
  });

  it("uses default key when LOCAL_DEV_CRYPTO_KEY is not provided", async () => {
    const adapter1 = new LocalAdapter();
    const adapter2 = new LocalAdapter({}); // Empty config

    const plaintext = "test-value";
    const envelope = await adapter1.encrypt(plaintext, testContext);

    // Both should use the same default key
    const decrypted = await adapter2.decrypt(envelope, testContext);
    expect(decrypted).toBe(plaintext);
  });

  it("fails with different password (different derived key)", async () => {
    const adapter1 = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "password-a" });
    const adapter2 = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "password-b" });

    const plaintext = "secret";
    const envelope = await adapter1.encrypt(plaintext, testContext);

    // Different password produces different key, so decryption should fail
    await expect(adapter2.decrypt(envelope, testContext)).rejects.toThrow(
      /unable to authenticate data|Unsupported state/,
    );
  });
});
