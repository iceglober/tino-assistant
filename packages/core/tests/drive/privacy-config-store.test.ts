import { describe, expect, it, vi } from "vitest";
import { createAppDataPrivacyConfigStore } from "../../src/drive/adapters/privacy-config-store.js";
import type { PrivacyConfigStore } from "../../src/privacy/config-store.js";
import type { PrivacyConfig } from "../../src/privacy/types.js";
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

function mockFallback(): PrivacyConfigStore {
  const store = new Map<string, PrivacyConfig>();
  return {
    async get(userId: string) { return store.get(userId) ?? null; },
    async set(userId: string, config: PrivacyConfig) { store.set(userId, config); },
    computeDelta: vi.fn(() => ({})),
    isAdditive: vi.fn(() => false),
  };
}

const testConfig: PrivacyConfig = {
  version: 2,
  email: { privateFolders: ["Personal"], denyListedAddresses: ["spam@example.com"] },
  lastReviewedAt: Date.now(),
};

describe("AppDataPrivacyConfigStore", () => {
  it("writes and reads from appDataFolder", async () => {
    const client = mockAppDataClient();
    const fallback = mockFallback();
    const store = createAppDataPrivacyConfigStore({
      resolveClient: async () => client,
      fallback,
      logger: noopLogger,
    });

    await store.set("user-1", testConfig);
    const result = await store.get("user-1");

    expect(result).toEqual(testConfig);
  });

  it("falls back when client is null", async () => {
    const fallback = mockFallback();
    await fallback.set("user-1", testConfig);

    const store = createAppDataPrivacyConfigStore({
      resolveClient: async () => null,
      fallback,
      logger: noopLogger,
    });

    const result = await store.get("user-1");
    expect(result).toEqual(testConfig);
  });

  it("falls back on appDataFolder read error", async () => {
    const client = mockAppDataClient();
    vi.spyOn(client, "readJson").mockRejectedValue(new Error("network error"));

    const fallback = mockFallback();
    await fallback.set("user-1", testConfig);

    const store = createAppDataPrivacyConfigStore({
      resolveClient: async () => client,
      fallback,
      logger: noopLogger,
    });

    const result = await store.get("user-1");
    expect(result).toEqual(testConfig);
  });

  it("falls back on appDataFolder write error", async () => {
    const client = mockAppDataClient();
    vi.spyOn(client, "writeJson").mockRejectedValue(new Error("network error"));

    const fallback = mockFallback();
    const store = createAppDataPrivacyConfigStore({
      resolveClient: async () => client,
      fallback,
      logger: noopLogger,
    });

    await store.set("user-1", testConfig);
    const result = await fallback.get("user-1");
    expect(result).toEqual(testConfig);
  });

  it("exposes computeDelta and isAdditive", () => {
    const fallback = mockFallback();
    const store = createAppDataPrivacyConfigStore({
      resolveClient: async () => null,
      fallback,
      logger: noopLogger,
    });

    expect(typeof store.computeDelta).toBe("function");
    expect(typeof store.isAdditive).toBe("function");
  });
});
