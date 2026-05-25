import type { ModelMessage } from "ai";
import type { HistoryStore } from "../../agent/history.js";
import { trim } from "../../agent/history.js";
import type { UserKeyStorePort } from "../../persistence/key-store.js";
import type { AppLogger } from "../../slack/app.js";
import { decrypt, encrypt, isEncryptedBlob } from "../crypto.js";
import type { EncryptedBlob } from "../types.js";

const ENCRYPTED_ROLE = "assistant" as const;

export function createEncryptedHistoryStore(deps: {
  inner: HistoryStore;
  keyStore: UserKeyStorePort;
  logger: AppLogger;
  cap?: number;
}): HistoryStore {
  const { inner, keyStore, logger, cap = 40 } = deps;

  function isEncryptedEnvelope(msgs: ModelMessage[]): msgs is [ModelMessage] {
    if (msgs.length !== 1 || !msgs[0]) return false;
    const content = msgs[0].content;
    if (typeof content !== "string") return false;
    try {
      return isEncryptedBlob(JSON.parse(content));
    } catch {
      return false;
    }
  }

  return {
    async get(userId: string): Promise<ModelMessage[]> {
      const raw = await inner.get(userId);
      if (raw.length === 0) return [];

      if (!isEncryptedEnvelope(raw)) return raw;

      const dek = await keyStore.getOrCreateKey(userId);
      if (!dek) {
        logger.info({ userId }, "encrypted-history: no DEK available, returning empty (encrypted data exists but cannot be decrypted)");
        return [];
      }

      try {
        const blob = JSON.parse(raw[0].content as string) as EncryptedBlob;
        const plaintext = decrypt(blob, dek);
        return JSON.parse(plaintext) as ModelMessage[];
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "encrypted-history: decryption failed");
        return [];
      }
    },

    async append(userId: string, msgs: ModelMessage[]): Promise<void> {
      const dek = await keyStore.getOrCreateKey(userId);
      if (!dek) {
        await inner.append(userId, msgs);
        return;
      }

      const existing = await this.get(userId);
      const combined = [...existing, ...msgs];
      const trimmed = trim(combined, cap);

      const plaintext = JSON.stringify(trimmed);
      const blob = encrypt(plaintext, dek);

      const envelope: ModelMessage = {
        role: ENCRYPTED_ROLE,
        content: JSON.stringify(blob),
      };

      await inner.reset(userId);
      await inner.append(userId, [envelope]);
    },

    async reset(userId: string): Promise<void> {
      await inner.reset(userId);
    },
  };
}
