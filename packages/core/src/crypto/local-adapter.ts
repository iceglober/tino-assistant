import crypto from "node:crypto";

import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "./types.js";

/**
 * Dev-only AES-256-GCM adapter using a static derived key.
 * Context is bound to AAD (Additional Authenticated Data) so that
 * context mismatch fails at auth-tag verification, preventing
 * cross-context decryption even if coding logic is buggy.
 */
export class LocalAdapter implements CryptoAdapter {
  private readonly derivedKey: Buffer;

  /**
   * Derive a 32-byte key via scrypt for consistent encryption across restarts.
   * @param config Optional configuration with LOCAL_DEV_CRYPTO_KEY password
   */
  constructor(config?: { LOCAL_DEV_CRYPTO_KEY?: string }) {
    const password = config?.LOCAL_DEV_CRYPTO_KEY ?? "dev-key";
    this.derivedKey = crypto.scryptSync(password, "salt", 32);
  }

  async encrypt(plaintext: string, context: EncryptionContext): Promise<EnvelopeCiphertext> {
    // Generate random 12-byte IV for each encryption
    const iv = crypto.randomBytes(12);

    // Create cipher with derived key and IV
    const cipher = crypto.createCipheriv("aes-256-gcm", this.derivedKey, iv);

    // Set AAD to context (prevents cross-context decryption)
    const aad = this.getAad(context);
    cipher.setAAD(aad);

    // Encrypt plaintext
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    // Extract auth tag (16 bytes)
    const authTag = cipher.getAuthTag();

    return {
      algorithm: "AES-256-GCM/v1",
      ciphertext: encrypted.toString("base64"),
      authTag: authTag.toString("base64"),
      iv: iv.toString("base64"),
      // encryptedDataKey is omitted for local adapter
    };
  }

  async decrypt(envelope: EnvelopeCiphertext, context: EncryptionContext): Promise<string> {
    // Decode components from base64
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    const iv = Buffer.from(envelope.iv, "base64");

    // Create decipher with derived key and IV
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.derivedKey, iv);

    // Set auth tag for verification
    decipher.setAuthTag(authTag);

    // Set AAD (must match what was set during encryption)
    const aad = this.getAad(context);
    decipher.setAAD(aad);

    // Decrypt plaintext (throws if auth tag fails)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted.toString("utf8");
  }

  private getAad(context: EncryptionContext): Buffer {
    // AAD is JSON-serialized context (same format as KMS EncryptionContext)
    // Binding context to AAD ensures cross-context decryption fails cryptographically
    return Buffer.from(
      JSON.stringify({
        userId: context.userId,
        capabilityId: context.capabilityId,
        fieldName: context.fieldName,
      }),
    );
  }
}
