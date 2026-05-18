/**
 * Encryption context: fixed 3-field schema for envelope encryption.
 * Bound to AAD (Additional Authenticated Data) to prevent cross-context decryption.
 */
export interface EncryptionContext {
  userId: string;
  capabilityId: string;
  fieldName: string;
}

/**
 * Encrypted envelope with separated components.
 * Algorithm field enables versioning for future changes.
 * encryptedDataKey is present for KMS adapter, omitted for local adapter.
 */
export interface EnvelopeCiphertext {
  algorithm: 'AES-256-GCM/v1';
  ciphertext: string; // base64-encoded AES-256-GCM ciphertext (without auth tag)
  authTag: string; // base64-encoded 16-byte auth tag
  iv: string; // base64-encoded 12-byte IV
  encryptedDataKey?: string; // base64-encoded KMS-encrypted data key (KMS adapter only)
}

/**
 * CryptoAdapter encrypts/decrypts with exact encryption-context matching.
 * Mismatched context fails cryptographically:
 * - KMS adapter: KMS.Decrypt throws InvalidCiphertextException
 * - Local adapter: AES-GCM auth-tag verification fails
 *
 * The context is bound to the ciphertext via AAD (Additional Authenticated Data).
 * Even if the KMS EncryptionContext were stripped (coding error), the local
 * GCM tag still enforces the context via AAD.
 */
export interface CryptoAdapter {
  /**
   * Encrypt plaintext with context-bound AAD.
   * @param plaintext The value to encrypt
   * @param context Three-field encryption context (userId, capabilityId, fieldName)
   * @returns EnvelopeCiphertext with algorithm, ciphertext, authTag, iv, and (for KMS) encryptedDataKey
   */
  encrypt(plaintext: string, context: EncryptionContext): Promise<EnvelopeCiphertext>;

  /**
   * Decrypt ciphertext with context verification.
   * @param envelope The EnvelopeCiphertext returned by encrypt()
   * @param context Must match the context used during encryption
   * @returns The plaintext
   * @throws If context doesn't match what was bound during encryption
   *   - KMS: InvalidCiphertextException from KMS API
   *   - Local: "Unsupported state or unable to authenticate data" from Node crypto
   */
  decrypt(envelope: EnvelopeCiphertext, context: EncryptionContext): Promise<string>;
}
