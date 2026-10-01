/** In-memory port fakes for core tests. Not exported from the package. */
import { vi } from "vitest";
import type { ConfigStore, Logger } from "../src/ports/outbound.js";

export function noopLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

export function makeConfigStore(entries: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, string>(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  const fake = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getTyped: vi.fn(async (key: string, fallback: unknown) => {
      const raw = store.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    }),
    list: vi.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value, updatedAt: Date.now() }))),
    delete: vi.fn(async (key: string) => store.delete(key)),
  };
  return fake as unknown as ConfigStore;
}
