import { describe, expect, it, vi } from "vitest";
import { createKeyManager } from "../../src/drive/key-manager.js";
import type { AppDataClient, EncryptedKeyEnvelope } from "../../src/drive/types.js";

function mockAppDataClient(): AppDataClient {
  const store = new Map<string, unknown>();

  return {
    async readJson<T>(fileName: string): Promise<T | null> {
      return (store.get(fileName) as T) ?? null;
    },
    async writeJson(fileName: string, data: unknown): Promise<void> {
      store.set(fileName, data);
    },
    async deleteFile(fileName: string): Promise<boolean> {
      return store.delete(fileName);
    },
    async listFiles(): Promise<Array<{ id: string; name: string }>> {
      return [...store.keys()].map((name, i) => ({ id: `id-${i}`, name }));
    },
  };
}

describe("AppDataKeyManager", () => {
  it("generates a 32-byte key on first access", async () => {
    const km = createKeyManager();
    const client = mockAppDataClient();

    const key = await km.getOrCreateKey("user-1", client);

    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
  });

  it("stores the key in appDataFolder", async () => {
    const km = createKeyManager();
    const client = mockAppDataClient();

    await km.getOrCreateKey("user-1", client);

    const envelope = await client.readJson<EncryptedKeyEnvelope>("encryption-key.json");
    expect(envelope).not.toBeNull();
    expect(envelope!.version).toBe(1);
    expect(envelope!.algorithm).toBe("AES-256-GCM");
    expect(Buffer.from(envelope!.key, "base64").length).toBe(32);
  });

  it("returns the same key on subsequent calls (cached)", async () => {
    const km = createKeyManager();
    const client = mockAppDataClient();

    const key1 = await km.getOrCreateKey("user-1", client);
    const key2 = await km.getOrCreateKey("user-1", client);

    expect(key1!.equals(key2!)).toBe(true);
  });

  it("reads existing key from appDataFolder", async () => {
    const km = createKeyManager();
    const client = mockAppDataClient();

    const key1 = await km.getOrCreateKey("user-1", client);

    // New key manager instance — no cache, must read from client
    const km2 = createKeyManager();
    const key2 = await km2.getOrCreateKey("user-1", client);

    expect(key1!.equals(key2!)).toBe(true);
  });

  it("generates different keys for different users", async () => {
    const km = createKeyManager();
    const client1 = mockAppDataClient();
    const client2 = mockAppDataClient();

    const key1 = await km.getOrCreateKey("user-1", client1);
    const key2 = await km.getOrCreateKey("user-2", client2);

    expect(key1!.equals(key2!)).toBe(false);
  });

  it("evicts cached key", async () => {
    const km = createKeyManager();
    const client = mockAppDataClient();
    const readSpy = vi.spyOn(client, "readJson");

    await km.getOrCreateKey("user-1", client);
    readSpy.mockClear();

    // Cached — should not call readJson
    await km.getOrCreateKey("user-1", client);
    expect(readSpy).not.toHaveBeenCalled();

    // Evict — next call must re-read
    km.evict("user-1");
    await km.getOrCreateKey("user-1", client);
    expect(readSpy).toHaveBeenCalledWith("encryption-key.json");
  });

  it("returns null if client throws", async () => {
    const km = createKeyManager();
    const client = mockAppDataClient();
    vi.spyOn(client, "readJson").mockRejectedValue(new Error("network error"));

    const key = await km.getOrCreateKey("user-1", client);
    expect(key).toBeNull();
  });
});
