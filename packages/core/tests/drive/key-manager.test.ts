import { describe, expect, it, vi } from "vitest";
import { createDriveKeyStore } from "../../src/drive/key-manager.js";
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

describe("DriveKeyStore", () => {
  it("generates a 32-byte key on first access", async () => {
    const client = mockAppDataClient();
    const ks = createDriveKeyStore({ resolveClient: async () => client });

    const key = await ks.getOrCreateKey("user-1");

    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
  });

  it("stores the key in appDataFolder", async () => {
    const client = mockAppDataClient();
    const ks = createDriveKeyStore({ resolveClient: async () => client });

    await ks.getOrCreateKey("user-1");

    const envelope = await client.readJson<EncryptedKeyEnvelope>("encryption-key.json");
    expect(envelope).not.toBeNull();
    expect(envelope!.version).toBe(1);
    expect(envelope!.algorithm).toBe("AES-256-GCM");
    expect(Buffer.from(envelope!.key, "base64").length).toBe(32);
  });

  it("returns the same key on subsequent calls (cached)", async () => {
    const client = mockAppDataClient();
    const ks = createDriveKeyStore({ resolveClient: async () => client });

    const key1 = await ks.getOrCreateKey("user-1");
    const key2 = await ks.getOrCreateKey("user-1");

    expect(key1!.equals(key2!)).toBe(true);
  });

  it("reads existing key from appDataFolder", async () => {
    const client = mockAppDataClient();
    const ks1 = createDriveKeyStore({ resolveClient: async () => client });
    const key1 = await ks1.getOrCreateKey("user-1");

    // New key store instance — no cache, must read from client
    const ks2 = createDriveKeyStore({ resolveClient: async () => client });
    const key2 = await ks2.getOrCreateKey("user-1");

    expect(key1!.equals(key2!)).toBe(true);
  });

  it("generates different keys for different users", async () => {
    const client1 = mockAppDataClient();
    const client2 = mockAppDataClient();
    const ks = createDriveKeyStore({
      resolveClient: async (userId) => (userId === "user-1" ? client1 : client2),
    });

    const key1 = await ks.getOrCreateKey("user-1");
    const key2 = await ks.getOrCreateKey("user-2");

    expect(key1!.equals(key2!)).toBe(false);
  });

  it("evicts cached key", async () => {
    const client = mockAppDataClient();
    const readSpy = vi.spyOn(client, "readJson");
    const ks = createDriveKeyStore({ resolveClient: async () => client });

    await ks.getOrCreateKey("user-1");
    readSpy.mockClear();

    // Cached — should not call readJson
    await ks.getOrCreateKey("user-1");
    expect(readSpy).not.toHaveBeenCalled();

    // Evict — next call must re-read
    ks.evict("user-1");
    await ks.getOrCreateKey("user-1");
    expect(readSpy).toHaveBeenCalledWith("encryption-key.json");
  });

  it("returns null if client is unavailable", async () => {
    const ks = createDriveKeyStore({ resolveClient: async () => null });

    const key = await ks.getOrCreateKey("user-1");
    expect(key).toBeNull();
  });

  it("returns null if client throws", async () => {
    const client = mockAppDataClient();
    vi.spyOn(client, "readJson").mockRejectedValue(new Error("network error"));
    const ks = createDriveKeyStore({ resolveClient: async () => client });

    const key = await ks.getOrCreateKey("user-1");
    expect(key).toBeNull();
  });
});
