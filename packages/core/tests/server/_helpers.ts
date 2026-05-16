/**
 * In-memory ConfigStore + AppLogger helpers shared by wave-3 server route
 * tests. Mirrors the helper inlined in `tests/capabilities/registry.test.ts`,
 * extracted here so each route test doesn't redeclare it.
 *
 * NOT exported from the package — purely a test fixture.
 */

import { vi } from "vitest";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AppLogger } from "../../src/slack/app.js";

export function noopLogger(): AppLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

export function makeConfigStore(entries: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, string>(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getTyped: vi.fn(async <T>(key: string, fallback: T): Promise<T> => {
      const raw = store.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    }),
    list: vi.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value, updatedAt: Date.now() }))),
    delete: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had;
    }),
  };
}
