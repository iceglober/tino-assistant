import { randomBytes } from "node:crypto";
import type { UserKeyStorePort } from "../persistence/key-store.js";
import type { AppDataClient, EncryptedKeyEnvelope } from "./types.js";

const KEY_FILE = "encryption-key.json";
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  key: Buffer;
  lastAccess: number;
}

export function createDriveKeyStore(deps: {
  resolveClient: (userId: string) => Promise<AppDataClient | null>;
}): UserKeyStorePort {
  const { resolveClient } = deps;
  const cache = new Map<string, CacheEntry>();

  // Lazy eviction: check TTL on access, sweep periodically.
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of cache) {
      if (now - entry.lastAccess > TTL_MS) cache.delete(id);
    }
  }, TTL_MS / 2);
  if (typeof sweepInterval === "object" && "unref" in sweepInterval) {
    sweepInterval.unref();
  }

  return {
    async getOrCreateKey(userId: string): Promise<Buffer | null> {
      const cached = cache.get(userId);
      if (cached) {
        if (Date.now() - cached.lastAccess <= TTL_MS) {
          cached.lastAccess = Date.now();
          return cached.key;
        }
        cache.delete(userId);
      }

      const client = await resolveClient(userId);
      if (!client) return null;

      try {
        const existing = await client.readJson<EncryptedKeyEnvelope>(KEY_FILE);
        if (existing?.key) {
          const key = Buffer.from(existing.key, "base64");
          if (key.length === 32) {
            cache.set(userId, { key, lastAccess: Date.now() });
            return key;
          }
        }

        const key = randomBytes(32);
        const envelope: EncryptedKeyEnvelope = {
          version: 1,
          algorithm: "AES-256-GCM",
          key: key.toString("base64"),
          createdAt: Date.now(),
        };
        await client.writeJson(KEY_FILE, envelope);
        cache.set(userId, { key, lastAccess: Date.now() });
        return key;
      } catch {
        return null;
      }
    },

    evict(userId: string): void {
      cache.delete(userId);
    },
  };
}
