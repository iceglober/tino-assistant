/**
 * Wave 3.2 — `CapabilityRegistry.reload()` regression tests.
 *
 * Acceptance items in `docs/plans/v2_1/wave_3.md` § 3.2:
 *   - save a GitHub PAT → `github tools enabled` log + tools registered
 *   - the next agent call uses the new tools (registry.tools reflects the
 *     post-reload state immediately)
 *   - removing credentials → tools deregistered
 *
 * Strategy: in-memory `ConfigStore`, real `initCapabilityRegistry`. We
 * mutate the store between reloads to simulate the console saving new
 * config and assert the tool surface tracks the config.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initCapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AppLogger } from "../../src/slack/app.js";

function makeLogger(): AppLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeConfigStore(entries: Record<string, unknown> = {}): ConfigStore {
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

const GITHUB_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: "ghp_test_token" },
  settings: { repos: ["kn-eng/kn-eng"], defaultRepo: "kn-eng/kn-eng" },
  findWork: { enabled: false, intervalMinutes: 15 },
};

describe("CapabilityRegistry.reload (wave 3.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. starting empty → reload after adding github config registers github tools", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    // Initially: no github tools.
    expect(registry.sharedTools.github_search_code).toBeUndefined();

    // Console saves a GitHub PAT (simulated).
    await configStore.set("capability.github", GITHUB_CONFIG);

    // Reload — the route handler calls this in production.
    const result = await registry.reload();
    expect(result.ok).toBe(true);

    // GitHub tools are now in the toolset.
    expect(registry.sharedTools.github_search_code).toBeDefined();
    expect(registry.sharedTools.github_get_file).toBeDefined();
    expect(registry.capabilityIds).toContain("github");

    // Operators grep `info` log lines for the post-reload diff.
    const infoCalls = (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const reloadLog = infoCalls.find(([, msg]) => msg === "capabilities reloaded");
    expect(reloadLog).toBeDefined();
    const [meta] = reloadLog as [{ before: string[]; after: string[] }, string];
    expect(meta.before).toEqual([]);
    expect(meta.after).toContain("github_search_code");
  });

  it("2. tools reference is mutated in place (consumers holding the old reference see the swap)", async () => {
    // The agent loop captures `registry.tools` at startup. If reload swapped
    // the object identity, the agent would never see the new tools without
    // a code change. Lock the in-place behaviour.
    const configStore = makeConfigStore({});
    const logger = makeLogger();
    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    const toolsRef = registry.sharedTools;
    expect(toolsRef.github_search_code).toBeUndefined();

    await configStore.set("capability.github", GITHUB_CONFIG);
    await registry.reload();

    // Same object identity, new contents — holders of `toolsRef` see github tools.
    expect(toolsRef).toBe(registry.sharedTools);
    expect(toolsRef.github_search_code).toBeDefined();
  });

  it("3. removing credentials → github tools are deregistered (gap #9 acceptance)", async () => {
    const configStore = makeConfigStore({ "capability.github": GITHUB_CONFIG });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });
    expect(registry.sharedTools.github_search_code).toBeDefined();

    // Console clears the token (simulate empty-token save).
    await configStore.set("capability.github", {
      ...GITHUB_CONFIG,
      credentials: { token: "" },
    });

    const result = await registry.reload();
    expect(result.ok).toBe(true);

    // No github_* tools.
    expect(registry.sharedTools.github_search_code).toBeUndefined();
    expect(registry.sharedTools.github_get_file).toBeUndefined();
    const githubKeys = Object.keys(registry.sharedTools).filter((k) => k.startsWith("github_"));
    expect(githubKeys).toEqual([]);

    // Capability list no longer includes github.
    expect(registry.capabilityIds).not.toContain("github");
  });

  it("4. preferences/tasks tools survive a reload (they are not capability tools)", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();
    const taskStore = {
      create: vi.fn(),
      getById: vi.fn(),
      listByUser: vi.fn().mockReturnValue([]),
      listPending: vi.fn().mockReturnValue([]),
      updateStatus: vi.fn(),
      cancel: vi.fn().mockReturnValue(true),
    };

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
      taskStore,
    });

    expect(registry.sharedTools.set_preference).toBeDefined();
    expect(registry.sharedTools.schedule_task).toBeDefined();

    await registry.reload();

    expect(registry.sharedTools.set_preference).toBeDefined();
    expect(registry.sharedTools.get_preferences).toBeDefined();
    expect(registry.sharedTools.schedule_task).toBeDefined();
    expect(registry.sharedTools.list_tasks).toBeDefined();
    expect(registry.sharedTools.cancel_task).toBeDefined();
  });

  it("5. disabling a capability → tools are removed on reload", async () => {
    const configStore = makeConfigStore({ "capability.github": GITHUB_CONFIG });
    const logger = makeLogger();
    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });
    expect(registry.sharedTools.github_search_code).toBeDefined();

    await configStore.set("capability.github", { ...GITHUB_CONFIG, enabled: false });
    await registry.reload();

    expect(registry.sharedTools.github_search_code).toBeUndefined();
  });

  it("6. reload returns { ok: true } even when a single capability fails to register", async () => {
    // Per-capability errors are caught by the registry's try/catch and
    // logged as warnings; they don't roll back the whole reload.
    // We simulate a failure by writing an enabled capability with empty
    // credentials — the github module throws on missing token.
    const configStore = makeConfigStore({});
    const logger = makeLogger();
    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    await configStore.set("capability.github", {
      enabled: true,
      credentials: {}, // missing token → registerTools throws
      settings: {},
    } satisfies CapabilityConfig);

    const result = await registry.reload();
    expect(result.ok).toBe(true);
    // github tools still not registered.
    expect(registry.sharedTools.github_search_code).toBeUndefined();
    // But preferences are intact — partial failure didn't blow up the rest.
    expect(registry.sharedTools.set_preference).toBeDefined();
  });
});
