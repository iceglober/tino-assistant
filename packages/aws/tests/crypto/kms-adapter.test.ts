import crypto from "node:crypto";

import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { KmsAdapter } from "../../src/crypto/kms-adapter.js";
import type { EncryptionContext } from "../../src/crypto/types.js";

describe("KmsAdapter", () => {
  const testContext: EncryptionContext = {
    userId: "user-123",
    capabilityId: "gmail",
    fieldName: "refreshToken",
  };

  const kmsKeyArn = "arn:aws:kms:us-east-1:123456789:key/12345678";
  let kmsMock: ReturnType<typeof mockClient>;
  let kmsClient: KMSClient;
  let adapter: KmsAdapter;

  beforeEach(() => {
    kmsMock = mockClient(KMSClient);
    kmsClient = new KMSClient({ region: "us-east-1" });
    adapter = new KmsAdapter(kmsClient, kmsKeyArn);
  });

  it("encrypts and decrypts with same context to recover plaintext", async () => {
    const plaintext = "secret-refresh-token";
    const plaintextKey = crypto.randomBytes(32); // 256-bit key

    // Mock GenerateDataKey to return the test key
    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: crypto.randomBytes(64), // Encrypted key (mocked)
      KeyId: kmsKeyArn,
    });

    // Mock Decrypt to return the same plaintext key
    kmsMock.on(DecryptCommand).resolves({
      Plaintext: Buffer.from(plaintextKey), // Create a new buffer instance
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt(plaintext, testContext);
    expect(envelope.algorithm).toBe("AES-256-GCM/v1");
    expect(envelope.ciphertext).toBeDefined();
    expect(envelope.authTag).toBeDefined();
    expect(envelope.iv).toBeDefined();
    expect(envelope.encryptedDataKey).toBeDefined();

    const decrypted = await adapter.decrypt(envelope, testContext);
    expect(decrypted).toBe(plaintext);
  });

  it("includes encryptedDataKey in envelope", async () => {
    const plaintext = "test-data";
    const plaintextKey = crypto.randomBytes(32);
    const encryptedKeyBlob = crypto.randomBytes(64);

    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: encryptedKeyBlob,
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt(plaintext, testContext);

    // Verify encryptedDataKey is present and matches what KMS returned
    expect(envelope.encryptedDataKey).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: checked above via toBeDefined()
    expect(Buffer.from(envelope.encryptedDataKey!, "base64")).toEqual(encryptedKeyBlob);
  });

  it("algorithm field is 'AES-256-GCM/v1'", async () => {
    const plaintextKey = crypto.randomBytes(32);
    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: crypto.randomBytes(64),
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt("test", testContext);
    expect(envelope.algorithm).toBe("AES-256-GCM/v1");
  });

  it("passes context to KMS GenerateDataKey", async () => {
    const plaintextKey = crypto.randomBytes(32);
    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: crypto.randomBytes(64),
      KeyId: kmsKeyArn,
    });

    await adapter.encrypt("test", testContext);

    // Verify KMS was called with the correct encryption context
    const call = kmsMock.call(0);
    expect(call.args[0]).toBeInstanceOf(GenerateDataKeyCommand);
    const cmd = call.args[0] as GenerateDataKeyCommand;
    expect(cmd.input.EncryptionContext).toEqual({
      userId: testContext.userId,
      capabilityId: testContext.capabilityId,
      fieldName: testContext.fieldName,
    });
  });

  it("passes context to KMS Decrypt", async () => {
    const plaintextKey = crypto.randomBytes(32);
    const encryptedKeyBlob = crypto.randomBytes(64);

    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: encryptedKeyBlob,
      KeyId: kmsKeyArn,
    });

    kmsMock.on(DecryptCommand).resolves({
      Plaintext: Buffer.from(plaintextKey),
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt("test", testContext);
    await adapter.decrypt(envelope, testContext);

    // Find the Decrypt call (should be after GenerateDataKey)
    const calls = kmsMock.commandCalls(DecryptCommand);
    expect(calls).toHaveLength(1);
    const cmd = calls[0].args[0] as DecryptCommand;
    expect(cmd.input.EncryptionContext).toEqual({
      userId: testContext.userId,
      capabilityId: testContext.capabilityId,
      fieldName: testContext.fieldName,
    });
  });

  it("throws when decrypt context userId mismatches (KMS rejects)", async () => {
    const plaintextKey = crypto.randomBytes(32);
    const encryptedKeyBlob = crypto.randomBytes(64);

    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: encryptedKeyBlob,
      KeyId: kmsKeyArn,
    });

    // First create an envelope with the original context
    const envelope = await adapter.encrypt("test", testContext);

    // Now mock Decrypt to throw InvalidCiphertextException when context is wrong
    kmsMock.on(DecryptCommand).rejects(new Error("InvalidCiphertextException"));

    const wrongContext: EncryptionContext = {
      ...testContext,
      userId: "different-user",
    };

    await expect(adapter.decrypt(envelope, wrongContext)).rejects.toThrow("InvalidCiphertextException");
  });

  it("throws when decrypt context capabilityId mismatches", async () => {
    const plaintextKey = crypto.randomBytes(32);
    const encryptedKeyBlob = crypto.randomBytes(64);

    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: encryptedKeyBlob,
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt("test", testContext);

    kmsMock.on(DecryptCommand).rejects(new Error("InvalidCiphertextException"));

    const wrongContext: EncryptionContext = {
      ...testContext,
      capabilityId: "slack",
    };

    await expect(adapter.decrypt(envelope, wrongContext)).rejects.toThrow("InvalidCiphertextException");
  });

  it("throws when decrypt context fieldName mismatches", async () => {
    const plaintextKey = crypto.randomBytes(32);
    const encryptedKeyBlob = crypto.randomBytes(64);

    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: encryptedKeyBlob,
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt("test", testContext);

    kmsMock.on(DecryptCommand).rejects(new Error("InvalidCiphertextException"));

    const wrongContext: EncryptionContext = {
      ...testContext,
      fieldName: "accessToken",
    };

    await expect(adapter.decrypt(envelope, wrongContext)).rejects.toThrow("InvalidCiphertextException");
  });

  it("throws if encryptedDataKey is missing from envelope", async () => {
    const envelope = {
      algorithm: "AES-256-GCM/v1" as const,
      ciphertext: "abc",
      authTag: "def",
      iv: "ghi",
      // encryptedDataKey is missing
    };

    await expect(adapter.decrypt(envelope, testContext)).rejects.toThrow("Missing encryptedDataKey");
  });

  it("IV is 12 bytes after base64 decode", async () => {
    const plaintextKey = crypto.randomBytes(32);
    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: crypto.randomBytes(64),
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt("test", testContext);
    const iv = Buffer.from(envelope.iv, "base64");
    expect(iv).toHaveLength(12);
  });

  it("authTag is 16 bytes after base64 decode", async () => {
    const plaintextKey = crypto.randomBytes(32);
    kmsMock.on(GenerateDataKeyCommand).resolves({
      Plaintext: plaintextKey,
      CiphertextBlob: crypto.randomBytes(64),
      KeyId: kmsKeyArn,
    });

    const envelope = await adapter.encrypt("test", testContext);
    const authTag = Buffer.from(envelope.authTag, "base64");
    expect(authTag).toHaveLength(16);
  });
});
