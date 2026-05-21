import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedBlob } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    __encrypted: true,
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(blob.iv, "base64");
  const authTag = Buffer.from(blob.authTag, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    typeof value === "object" &&
    value !== null &&
    "__encrypted" in value &&
    (value as EncryptedBlob).__encrypted === true
  );
}
