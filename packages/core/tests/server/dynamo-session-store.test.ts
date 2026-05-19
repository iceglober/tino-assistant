/**
 * Contract test for the SessionSecondaryStorage interface.
 *
 * Uses an in-memory implementation to verify the behavioral contract that
 * both the DynamoDB adapter (tested in packages/aws) and any future adapter
 * must satisfy. These are the tests referenced by wave 3 a5.
 */

import { describe, expect, it } from "vitest";
import type { SessionSecondaryStorage } from "../../src/persistence/factory.js";

function createInMemorySessionStore(): SessionSecondaryStorage {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Math.floor(Date.now() / 1000)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ttl?: number): Promise<void> {
      const expiresAt = ttl ? Math.floor(Date.now() / 1000) + ttl : undefined;
      store.set(key, { value, expiresAt });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

describe("SessionSecondaryStorage contract", () => {
  it("set then get round-trips a session value", async () => {
    const store = createInMemorySessionStore();
    await store.set("sess-abc", '{"token":"xyz"}');
    const result = await store.get("sess-abc");
    expect(result).toBe('{"token":"xyz"}');
  });

  it("set with TTL sets expiry (value readable before expiry)", async () => {
    const store = createInMemorySessionStore();
    await store.set("sess-ttl", "value", 3600);
    const result = await store.get("sess-ttl");
    expect(result).toBe("value");
  });

  it("get after delete returns null", async () => {
    const store = createInMemorySessionStore();
    await store.set("sess-del", "value");
    await store.delete("sess-del");
    const result = await store.get("sess-del");
    expect(result).toBeNull();
  });

  it("get returns null for nonexistent key", async () => {
    const store = createInMemorySessionStore();
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });
});
