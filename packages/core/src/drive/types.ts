export interface AppDataClient {
  readJson<T>(fileName: string): Promise<T | null>;
  writeJson(fileName: string, data: unknown): Promise<void>;
  deleteFile(fileName: string): Promise<boolean>;
  listFiles(): Promise<Array<{ id: string; name: string }>>;
}

export type AppDataErrorCode =
  | "not_found"
  | "auth_failed"
  | "scope_missing"
  | "rate_limited"
  | "network";

export class AppDataError extends Error {
  constructor(
    public readonly code: AppDataErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppDataError";
  }
}

export interface EncryptedKeyEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  key: string;
  createdAt: number;
}

export interface EncryptedBlob {
  __encrypted: true;
  ciphertext: string;
  iv: string;
  authTag: string;
}
