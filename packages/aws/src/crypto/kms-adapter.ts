import crypto from "node:crypto";

import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from "@aws-sdk/client-kms";

import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "./types.js";

/**
 * Production AWS KMS-backed adapter using envelope encryption.
 * Context is bound to KMS EncryptionContext and to AAD (Additional Authenticated Data).
 * Context mismatch fails at:
 * - KMS layer: InvalidCiphertextException from KMS.Decrypt
 * - AES layer: auth-tag verification fails (defense in depth)
 */
export class KmsAdapter implements CryptoAdapter {
  private readonly kmsClient: KMSClient;
  private readonly kmsKeyArn: string;

  /**
   * @param kmsClient AWS KMS client
   * @param kmsKeyArn KMS key ARN or alias (e.g., arn:aws:kms:us-east-1:123456789:key/12345678)
   */
  constructor(kmsClient: KMSClient, kmsKeyArn: string) {
    this.kmsClient = kmsClient;
    this.kmsKeyArn = kmsKeyArn;
  }

  async encrypt(plaintext: string, context: EncryptionContext): Promise<EnvelopeCiphertext> {
    // Step 1: Generate a 256-bit data key from KMS with context binding
    const kmsContext = this.contextToKmsContext(context);
    const generateCmd = new GenerateDataKeyCommand({
      KeyId: this.kmsKeyArn,
      KeySpec: "AES_256",
      EncryptionContext: kmsContext,
    });

    const { Plaintext: plaintextKey, CiphertextBlob: encryptedKey } = await this.kmsClient.send(generateCmd);

    if (!plaintextKey || !encryptedKey) {
      throw new Error("KMS GenerateDataKey returned empty key material");
    }

    // Step 2: Encrypt plaintext with AES-256-GCM using the plaintext data key
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", plaintextKey, iv);

    // Set AAD to further bind context to ciphertext (defense in depth)
    const aad = this.getAad(context);
    cipher.setAAD(aad);

    // Encrypt plaintext
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Step 3: Zero out plaintext key from memory (best-effort)
    plaintextKey.fill(0);

    return {
      algorithm: "AES-256-GCM/v1",
      ciphertext: encrypted.toString("base64"),
      authTag: authTag.toString("base64"),
      iv: iv.toString("base64"),
      encryptedDataKey: Buffer.from(encryptedKey).toString("base64"),
    };
  }

  async decrypt(envelope: EnvelopeCiphertext, context: EncryptionContext): Promise<string> {
    if (!envelope.encryptedDataKey) {
      throw new Error("Missing encryptedDataKey in envelope (KMS adapter requires it)");
    }

    // Step 1: Decrypt the data key with KMS (throws InvalidCiphertextException if context doesn't match)
    const kmsContext = this.contextToKmsContext(context);
    const decryptCmd = new DecryptCommand({
      CiphertextBlob: Buffer.from(envelope.encryptedDataKey, "base64"),
      EncryptionContext: kmsContext,
    });

    const { Plaintext: plaintextKey } = await this.kmsClient.send(decryptCmd);

    if (!plaintextKey) {
      throw new Error("KMS Decrypt returned empty key material");
    }

    // Step 2: Decrypt ciphertext with AES-256-GCM
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    const iv = Buffer.from(envelope.iv, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", plaintextKey, iv);

    // Set auth tag for verification
    decipher.setAuthTag(authTag);

    // Set AAD (must match what was set during encryption)
    const aad = this.getAad(context);
    decipher.setAAD(aad);

    // Decrypt plaintext (throws if auth tag fails)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Step 3: Zero out plaintext key from memory (best-effort)
    plaintextKey.fill(0);

    return decrypted.toString("utf8");
  }

  private contextToKmsContext(ctx: EncryptionContext): Record<string, string> {
    // Marshal 3-field context to flat KMS EncryptionContext
    return {
      userId: ctx.userId,
      capabilityId: ctx.capabilityId,
      fieldName: ctx.fieldName,
    };
  }

  private getAad(context: EncryptionContext): Buffer {
    // AAD is JSON-serialized context (same as KMS EncryptionContext)
    // Binding context to AAD ensures cross-context decryption fails at AES layer
    // even if KMS EncryptionContext were somehow bypassed
    return Buffer.from(JSON.stringify(this.contextToKmsContext(context)));
  }
}
