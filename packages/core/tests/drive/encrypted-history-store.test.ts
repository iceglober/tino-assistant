import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "../../src/agent/history.js";
import { createEncryptedHistoryStore } from "../../src/drive/adapters/encrypted-history-store.js";
import { isEncryptedBlob } from "../../src/drive/crypto.js";
import { createDriveKeyStore } from "../../src/drive/key-manager.js";
import type { AppDataClient } from "../../src/drive/types.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => noopLogger,
  // biome-ignore lint/suspicious/noExplicitAny: test mock
} as any;

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

describe("EncryptedHistoryStore", () => {
  it("encrypts and decrypts conversation round-trip", async () => {
    const inner = createHistoryStore({ cap: 40 });
    const client = mockAppDataClient();
    const keyStore = createDriveKeyStore({ resolveClient: async () => client });

    const store = createEncryptedHistoryStore({
      inner,
      keyStore,
      logger: noopLogger,
    });

    const msgs: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];

    await store.append("user-1", msgs);
    const result = await store.get("user-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "user", content: "hello" });
    expect(result[1]).toEqual({ role: "assistant", content: "hi there" });
  });

  it("stores ciphertext in the inner store", async () => {
    const inner = createHistoryStore({ cap: 40 });
    const client = mockAppDataClient();
    const keyStore = createDriveKeyStore({ resolveClient: async () => client });

    const store = createEncryptedHistoryStore({
      inner,
      keyStore,
      logger: noopLogger,
    });

    await store.append("user-1", [{ role: "user", content: "secret" }]);

    const raw = await inner.get("user-1");
    expect(raw).toHaveLength(1);

    const content = raw[0]!.content;
    expect(typeof content).toBe("string");
    const parsed = JSON.parse(content as string);
    expect(isEncryptedBlob(parsed)).toBe(true);
    expect(parsed.ciphertext).not.toContain("secret");
  });

  it("falls back to plaintext when no DEK available", async () => {
    const inner = createHistoryStore({ cap: 40 });
    const keyStore = createDriveKeyStore({ resolveClient: async () => null });

    const store = createEncryptedHistoryStore({
      inner,
      keyStore,
      logger: noopLogger,
    });

    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }];
    await store.append("user-1", msgs);

    const raw = await inner.get("user-1");
    expect(raw).toHaveLength(1);
    expect(raw[0]!.content).toBe("hello");
  });

  it("reads pre-existing plaintext messages", async () => {
    const inner = createHistoryStore({ cap: 40 });
    const client = mockAppDataClient();
    const keyStore = createDriveKeyStore({ resolveClient: async () => client });

    // Write plaintext directly to inner store (simulates pre-encryption data)
    await inner.append("user-1", [
      { role: "user", content: "old message" },
      { role: "assistant", content: "old reply" },
    ]);

    const store = createEncryptedHistoryStore({
      inner,
      keyStore,
      logger: noopLogger,
    });

    const result = await store.get("user-1");
    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe("old message");
  });

  it("trims to cap after appending", async () => {
    const inner = createHistoryStore({ cap: 100 });
    const client = mockAppDataClient();
    const keyStore = createDriveKeyStore({ resolveClient: async () => client });

    const store = createEncryptedHistoryStore({
      inner,
      keyStore,
      logger: noopLogger,
      cap: 3,
    });

    await store.append("user-1", [
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
    ]);
    await store.append("user-1", [
      { role: "user", content: "3" },
      { role: "assistant", content: "4" },
    ]);

    const result = await store.get("user-1");
    expect(result).toHaveLength(3);
    expect(result[0]!.content).toBe("2");
    expect(result[2]!.content).toBe("4");
  });

  it("reset clears the inner store", async () => {
    const inner = createHistoryStore({ cap: 40 });
    const client = mockAppDataClient();
    const keyStore = createDriveKeyStore({ resolveClient: async () => client });

    const store = createEncryptedHistoryStore({
      inner,
      keyStore,
      logger: noopLogger,
    });

    await store.append("user-1", [{ role: "user", content: "hello" }]);
    await store.reset("user-1");

    const result = await store.get("user-1");
    expect(result).toHaveLength(0);
  });

  it("returns empty when encrypted data exists but DEK is unavailable", async () => {
    const inner = createHistoryStore({ cap: 40 });
    const client = mockAppDataClient();
    const keyStore = createDriveKeyStore({ resolveClient: async () => client });

    // Write encrypted data with DEK
    const store = createEncryptedHistoryStore({
      inner,
      keyStore,
      logger: noopLogger,
    });
    await store.append("user-1", [{ role: "user", content: "secret" }]);

    // Read without DEK — should return empty, not crash
    const noKeyStore = createDriveKeyStore({ resolveClient: async () => null });
    const noKeyHistoryStore = createEncryptedHistoryStore({
      inner,
      keyStore: noKeyStore,
      logger: noopLogger,
    });
    const result = await noKeyHistoryStore.get("user-1");
    expect(result).toHaveLength(0);
  });
});
