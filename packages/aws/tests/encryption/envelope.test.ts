/**
 * Envelope encryption tests.
 *
 * All KMS calls are mocked — no real AWS credentials needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import type { KMSClient } from '@aws-sdk/client-kms';
import { encryptValue, decryptValue } from '../../src/encryption/envelope.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fake 32-byte AES key as Uint8Array (matches KMS AES_256 output). */
function fakeAesKey(): Uint8Array {
  return crypto.randomBytes(32);
}

/** Build a fake "encrypted" data key blob (just random bytes — KMS would encrypt it). */
function fakeEncryptedKey(): Uint8Array {
  return crypto.randomBytes(32);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('encryptValue', () => {
  it('returns an EncryptedValue with all three fields present and base64-encoded', async () => {
    const plaintextKey = fakeAesKey();
    const encryptedKey = fakeEncryptedKey();

    const mockKms = {
      send: vi.fn().mockResolvedValue({
        Plaintext: plaintextKey,
        CiphertextBlob: encryptedKey,
      }),
    } as unknown as KMSClient;

    const result = await encryptValue(mockKms, 'alias/tino', 'user-123', 'my-secret-token');

    // All three fields must be present
    expect(result).toHaveProperty('ciphertext');
    expect(result).toHaveProperty('dataKey');
    expect(result).toHaveProperty('iv');

    // Each field must be a non-empty base64 string
    const base64Re = /^[A-Za-z0-9+/]+=*$/;
    expect(result.ciphertext).toMatch(base64Re);
    expect(result.dataKey).toMatch(base64Re);
    expect(result.iv).toMatch(base64Re);

    // IV must decode to 12 bytes (AES-GCM standard)
    expect(Buffer.from(result.iv, 'base64').length).toBe(12);

    // dataKey must round-trip to the encrypted key bytes
    expect(Buffer.from(result.dataKey, 'base64')).toEqual(Buffer.from(encryptedKey));
  });

  it('passes the userId as encryptionContext to KMS GenerateDataKey', async () => {
    const plaintextKey = fakeAesKey();
    const encryptedKey = fakeEncryptedKey();
    const mockSend = vi.fn().mockResolvedValue({
      Plaintext: plaintextKey,
      CiphertextBlob: encryptedKey,
    });
    const mockKms = { send: mockSend } as unknown as KMSClient;

    await encryptValue(mockKms, 'alias/tino', 'user-abc', 'token');

    const sentCommand = mockSend.mock.calls[0]?.[0] as {
      input: { EncryptionContext: Record<string, string> };
    };
    expect(sentCommand.input.EncryptionContext).toEqual({ userId: 'user-abc' });
  });
});

describe('decryptValue', () => {
  it('round-trips: encrypt then decrypt recovers the original plaintext', async () => {
    // Use a real AES key so the crypto operations actually work.
    // IMPORTANT: encryptValue zeroes the plaintextKey buffer after use (best-effort
    // memory hygiene). We must supply a fresh copy for the Decrypt mock so the
    // decipher has the original key bytes.
    const plaintextKeyBytes = fakeAesKey();
    const encryptedKey = fakeEncryptedKey();
    const originalText = 'xoxp-super-secret-slack-token';

    const mockKms = {
      send: vi.fn()
        // GenerateDataKey: return a copy so the original isn't zeroed by encryptValue
        .mockResolvedValueOnce({
          Plaintext: Uint8Array.from(plaintextKeyBytes),
          CiphertextBlob: encryptedKey,
        })
        // Decrypt: return another copy with the same key bytes
        .mockResolvedValueOnce({ Plaintext: Uint8Array.from(plaintextKeyBytes) }),
    } as unknown as KMSClient;

    const encrypted = await encryptValue(mockKms, 'alias/tino', 'user-123', originalText);
    const decrypted = await decryptValue(mockKms, 'user-123', encrypted);

    expect(decrypted).toBe(originalText);
  });

  it('passes the userId as encryptionContext to KMS Decrypt', async () => {
    const plaintextKeyBytes = fakeAesKey();
    const encryptedKey = fakeEncryptedKey();

    const mockSend = vi.fn()
      .mockResolvedValueOnce({
        Plaintext: Uint8Array.from(plaintextKeyBytes),
        CiphertextBlob: encryptedKey,
      })
      .mockResolvedValueOnce({ Plaintext: Uint8Array.from(plaintextKeyBytes) });
    const mockKms = { send: mockSend } as unknown as KMSClient;

    const encrypted = await encryptValue(mockKms, 'alias/tino', 'user-xyz', 'token');
    await decryptValue(mockKms, 'user-xyz', encrypted);

    // Second call is the Decrypt command
    const decryptCommand = mockSend.mock.calls[1]?.[0] as {
      input: { EncryptionContext: Record<string, string> };
    };
    expect(decryptCommand.input.EncryptionContext).toEqual({ userId: 'user-xyz' });
  });

  it('decrypt with wrong userId fails when KMS rejects the context', async () => {
    const plaintextKey = fakeAesKey();
    const encryptedKey = fakeEncryptedKey();

    // Encrypt with user-A
    const encryptMock = vi.fn().mockResolvedValue({
      Plaintext: plaintextKey,
      CiphertextBlob: encryptedKey,
    });
    const encryptKms = { send: encryptMock } as unknown as KMSClient;
    const encrypted = await encryptValue(encryptKms, 'alias/tino', 'user-A', 'secret');

    // Attempt to decrypt with user-B — KMS throws InvalidCiphertextException
    const kmsError = new Error('The ciphertext refers to a customer master key that does not exist');
    kmsError.name = 'InvalidCiphertextException';

    const decryptMock = vi.fn().mockRejectedValue(kmsError);
    const decryptKms = { send: decryptMock } as unknown as KMSClient;

    await expect(decryptValue(decryptKms, 'user-B', encrypted)).rejects.toMatchObject({
      name: 'InvalidCiphertextException',
    });
  });
});
