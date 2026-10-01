/**
 * Per-field envelope encryption for user-capability credentials, shared by the
 * sqlite and postgres UserCapabilityStore adapters. Each credential field is
 * encrypted with a (userId, capabilityId, fieldName) context bound as AAD, so
 * ciphertexts cannot be replayed across users, capabilities, or fields.
 */
import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "../../../ports/outbound.js";

export async function encryptCredentials(
  cryptoAdapter: CryptoAdapter,
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

export async function decryptCredentials(
  cryptoAdapter: CryptoAdapter,
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
