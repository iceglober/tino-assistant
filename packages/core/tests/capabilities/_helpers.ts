/**
 * Shared helpers for wave-3 § 3.2 capability module tests.
 *
 * Mirrors `registry.test.ts`: in-memory `ConfigStore` and `AppLogger` doubles
 * extracted so each capability test doesn't redeclare them.
 *
 * NOT exported from the package — purely a test fixture.
 */

import { vi } from "vitest";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AppLogger } from "../../src/slack/app.js";

export function makeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
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
