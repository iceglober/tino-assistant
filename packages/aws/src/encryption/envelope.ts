import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import crypto from 'node:crypto';

export interface EncryptedValue {
  /** base64-encoded AES-256-GCM ciphertext (includes 16-byte auth tag appended) */
  ciphertext: string;
  /** base64-encoded KMS-encrypted data key */
  dataKey: string;
  /** base64-encoded 12-byte initialization vector */
  iv: string;
}

/**
 * Encrypt a value using envelope encryption with KMS.
 *
 * 1. Call KMS GenerateDataKey to get a plaintext + encrypted data key.
 * 2. Encrypt the value with the plaintext data key (AES-256-GCM).
 * 3. Return the encrypted value + encrypted data key + IV.
 * 4. The plaintext data key is never stored.
 *
 * The encryptionContext includes the userId so that decryption only
 * works when the correct userId is provided — prevents cross-user
 * token access even if the application code has a bug.
 */
export async function encryptValue(
  kmsClient: KMSClient,
  kmsKeyId: string,
  userId: string,
  plaintext: string,
): Promise<EncryptedValue> {
  // Step 1: Generate a data key from KMS
  const generateCmd = new GenerateDataKeyCommand({
    KeyId: kmsKeyId,
    KeySpec: 'AES_256',
    EncryptionContext: { userId },
  });

  const { Plaintext: plaintextKey, CiphertextBlob: encryptedKey } =
    await kmsClient.send(generateCmd);

  if (!plaintextKey || !encryptedKey) {
    throw new Error('KMS GenerateDataKey returned empty key material');
  }

  // Step 2: Encrypt the plaintext value with AES-256-GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(plaintextKey),
    iv,
  );

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(), // 16-byte auth tag appended to ciphertext
  ]);

  // Step 3: Zero out the plaintext key from memory (best-effort)
  plaintextKey.fill(0);

  return {
    ciphertext: encrypted.toString('base64'),
    dataKey: Buffer.from(encryptedKey).toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypt a value using envelope encryption with KMS.
 *
 * 1. Call KMS Decrypt to recover the plaintext data key (requires matching
 *    encryptionContext — KMS will reject if userId doesn't match).
 * 2. Decrypt the value with the plaintext data key (AES-256-GCM).
 * 3. Return the plaintext.
 * 4. The plaintext data key is never stored.
 */
export async function decryptValue(
  kmsClient: KMSClient,
  userId: string,
  encrypted: EncryptedValue,
): Promise<string> {
  // Step 1: Decrypt the data key with KMS (context must match)
  const decryptCmd = new DecryptCommand({
    CiphertextBlob: Buffer.from(encrypted.dataKey, 'base64'),
    EncryptionContext: { userId },
  });

  const { Plaintext: plaintextKey } = await kmsClient.send(decryptCmd);

  if (!plaintextKey) {
    throw new Error('KMS Decrypt returned empty key material');
  }

  // Step 2: Decrypt the ciphertext with AES-256-GCM
  const ciphertextWithTag = Buffer.from(encrypted.ciphertext, 'base64');
  const iv = Buffer.from(encrypted.iv, 'base64');

  // Auth tag is the last 16 bytes; ciphertext is everything before
  const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(plaintextKey),
    iv,
  );
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  // Zero out the plaintext key from memory (best-effort)
  plaintextKey.fill(0);

  return decrypted.toString('utf8');
}
