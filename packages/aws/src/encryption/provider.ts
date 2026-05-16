import type { KMSClient } from "@aws-sdk/client-kms";
import { decryptValue, type EncryptedValue, encryptValue } from "./envelope.js";

/**
 * EncryptionProvider abstracts envelope encryption so that:
 * - The DynamoDB config store can encrypt/decrypt credential values without
 *   knowing the KMS implementation details.
 * - Local dev (SQLite) can use a no-op provider that stores plaintext.
 * - Tests can inject a mock provider.
 */
export interface EncryptionProvider {
  /**
   * Encrypt a plaintext credential value for the given user.
   * Returns a JSON string of EncryptedValue that can be stored in DynamoDB.
   */
  encrypt(userId: string, plaintext: string): Promise<string>;

  /**
   * Decrypt a credential value for the given user.
   * Accepts the JSON string returned by encrypt().
   */
  decrypt(userId: string, ciphertext: string): Promise<string>;
}

/**
 * KMS-backed EncryptionProvider using envelope encryption.
 *
 * Stores the EncryptedValue (ciphertext + encrypted data key + IV) as a
 * JSON string in DynamoDB. The plaintext data key is never persisted.
 */
export class KmsEncryptionProvider implements EncryptionProvider {
  private readonly kmsClient: KMSClient;
  private readonly kmsKeyId: string;

  constructor(kmsClient: KMSClient, kmsKeyId: string) {
    this.kmsClient = kmsClient;
    this.kmsKeyId = kmsKeyId;
  }

  async encrypt(userId: string, plaintext: string): Promise<string> {
    const encrypted = await encryptValue(this.kmsClient, this.kmsKeyId, userId, plaintext);
    return JSON.stringify(encrypted);
  }

  async decrypt(userId: string, ciphertext: string): Promise<string> {
    const encrypted = JSON.parse(ciphertext) as EncryptedValue;
    return decryptValue(this.kmsClient, userId, encrypted);
  }
}
