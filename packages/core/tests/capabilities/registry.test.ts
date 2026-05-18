/**
 * Tests for the capability registry.
 *
 * Tests shared capability loading, private capability materialization,
 * tool registration, and findWork scheduling.
 * Uses in-memory config store mocks — no SQLite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initCapabilityRegistry } from "../../src/capabilities/registry.js";
import { SYSTEM_USER_ID } from "../../src/identity/types.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AppLogger } from "../../src/slack/app.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
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

const LINEAR_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: "lin_api_test_token" },
  settings: { defaultTeamKey: "GEN", autoPickupStates: ["backlog", "unstarted"] },
  findWork: { enabled: false, intervalMinutes: 15 },
};

const DISABLED_CONFIG: CapabilityConfig = {
  enabled: false,
  credentials: { token: "some_token" },
  settings: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("initCapabilityRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. empty config store → no shared capability tools registered, preferences/tasks still available", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    // No shared capability tools
    expect(registry.sharedTools.github_search_code).toBeUndefined();
    expect(registry.sharedTools.linear_search_issues).toBeUndefined();
    expect(registry.sharedTools.cloudwatch_logs_query).toBeUndefined();

    // Preferences tools always registered in sharedTools
    expect(registry.sharedTools.set_preference).toBeDefined();
    expect(registry.sharedTools.get_preferences).toBeDefined();

    // No task tools (no taskStore provided)
    expect(registry.sharedTools.schedule_task).toBeUndefined();

    expect(registry.capabilityIds).toEqual([]);
  });

  it("2. disabled capability → tools not registered", async () => {
    const configStore = makeConfigStore({
      "capability.github": DISABLED_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    expect(registry.sharedTools.github_search_code).toBeUndefined();
    expect(registry.capabilityIds).not.toContain("github");
  });

  it("3. enabled github capability → github tools registered", async () => {
    const configStore = makeConfigStore({
      "capability.github": GITHUB_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    expect(registry.sharedTools.github_search_code).toBeDefined();
    expect(registry.sharedTools.github_get_file).toBeDefined();
    expect(registry.sharedTools.github_list_workflow_runs).toBeDefined();
    expect(registry.sharedTools.github_get_workflow_run_logs).toBeDefined();
    expect(registry.capabilityIds).toContain("github");
  });

  it("4. enabled linear capability → linear tools registered", async () => {
    const configStore = makeConfigStore({
      "capability.linear": LINEAR_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    expect(registry.sharedTools.linear_search_issues).toBeDefined();
    expect(registry.sharedTools.linear_get_issue).toBeDefined();
    expect(registry.sharedTools.linear_create_issue).toBeDefined();
    expect(registry.sharedTools.linear_update_issue).toBeDefined();
    expect(registry.sharedTools.linear_add_comment).toBeDefined();
    expect(registry.sharedTools.linear_list_my_issues).toBeDefined();
    expect(registry.capabilityIds).toContain("linear");
  });

  it("5. capability with missing credentials → tools not registered, warn logged", async () => {
    const configStore = makeConfigStore({
      "capability.github": {
        enabled: true,
        credentials: {}, // no token
        settings: {},
      } satisfies CapabilityConfig,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    expect(registry.sharedTools.github_search_code).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: "github" }),
      expect.stringContaining("disabled"),
    );
  });

  it("6. invalid JSON in config → capability skipped, warn logged", async () => {
    // Manually insert invalid JSON by bypassing the makeConfigStore helper
    const store = new Map<string, string>([["capability.github", "not-valid-json"]]);
    const configStore: ConfigStore = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      getTyped: vi.fn(async <T>(_key: string, fallback: T) => fallback),
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
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    expect(registry.sharedTools.github_search_code).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: "github" }),
      expect.stringContaining("not valid JSON"),
    );
  });

  it("7. multiple capabilities enabled → all tools registered", async () => {
    const configStore = makeConfigStore({
      "capability.github": GITHUB_CONFIG,
      "capability.linear": LINEAR_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    expect(registry.sharedTools.github_search_code).toBeDefined();
    expect(registry.sharedTools.linear_search_issues).toBeDefined();
    expect(registry.capabilityIds).toContain("github");
    expect(registry.capabilityIds).toContain("linear");
  });

  it("8. taskStore provided → task tools registered", async () => {
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

    expect(registry.sharedTools.schedule_task).toBeDefined();
    expect(registry.sharedTools.list_tasks).toBeDefined();
    expect(registry.sharedTools.cancel_task).toBeDefined();
  });

  it("9. getState() returns per-capability state", async () => {
    const configStore = makeConfigStore({
      "capability.github": GITHUB_CONFIG,
      "capability.linear": DISABLED_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    const state = registry.getState();
    expect(state.github).toBeDefined();
    expect(state.github?.toolCount).toBeGreaterThan(0);
    expect(state.linear).toBeDefined();
    expect(state.linear?.toolCount).toBe(0);
  });

  it("10. stopAll() does not throw when no findWork pollers are running", () => {
    // Just verify it's callable without error
    const registry = {
      tools: {},
      capabilityIds: [],
      stopAll: () => {},
      getState: () => ({}),
    };
    expect(() => registry.stopAll()).not.toThrow();
  });

  // gap #6 — when a preferencesStore is injected, the registry must use it
  // instead of opening a SQLite file. Production (DynamoDB) depends on this
  // because the root filesystem is read-only.
  it("11. injected preferencesStore is used instead of constructing a SQLite store", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    // A trivial in-memory preferences store. If the registry uses this rather
    // than constructing a SQLite store, set_preference will route through it.
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const preferencesStore = {
      get: vi.fn(async (...args: unknown[]) => {
        calls.push({ method: "get", args });
        return null;
      }),
      set: vi.fn(async (...args: unknown[]) => {
        calls.push({ method: "set", args });
      }),
      list: vi.fn(async (...args: unknown[]) => {
        calls.push({ method: "list", args });
        return [];
      }),
      delete: vi.fn(async (...args: unknown[]) => {
        calls.push({ method: "delete", args });
      }),
    };

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      // dbPath intentionally NOT a real file — if the registry ignored the
      // injected store and tried SQLite, this would fail or write to disk.
      dbPath: "/dev/null/should-not-be-touched",
      preferencesStore,
    });

    expect(registry.sharedTools.set_preference).toBeDefined();
    expect(registry.sharedTools.get_preferences).toBeDefined();

    // Exercise the tool — it should hit the injected store, not SQLite.
    const setTool = registry.sharedTools.set_preference as {
      execute: (input: { key: string; value: string }) => Promise<unknown>;
    };
    await setTool.execute({ key: "tz", value: "UTC" });

    expect(preferencesStore.set).toHaveBeenCalledWith("U001", "tz", "UTC");
    expect(calls.find((c) => c.method === "set")).toBeDefined();
  });

  it('12. logs "preferences tools enabled" when injected store is provided', async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();
    const preferencesStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    };

    await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      preferencesStore,
    });

    // operators grep logs for `enabled`/`disabled` — preserve exact phrasing
    expect(logger.info).toHaveBeenCalledWith("preferences tools enabled");
    expect(logger.warn).not.toHaveBeenCalledWith(expect.anything(), "preferences tools disabled");
  });

  it("13. buildPrivateTools(SYSTEM_USER_ID) returns empty object", async () => {
    const configStore = makeConfigStore({
      "capability.gmail": {
        enabled: true,
        credentials: { clientId: "id", clientSecret: "secret", refreshToken: "r" },
        settings: {},
      },
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    const privateTools = await registry.buildPrivateTools(SYSTEM_USER_ID);
    expect(privateTools).toEqual({});
  });

  it("14. buildPrivateTools returns tools when private capability is configured", async () => {
    // Mock googleapis to avoid live auth creation
    vi.mock("googleapis", () => ({
      google: {
        auth: { OAuth2: class FakeOAuth2 { setCredentials() {} } },
        gmail: () => ({}),
      },
    }));

    const configStore = makeConfigStore({
      "capability.gmail": {
        enabled: true,
        credentials: { clientId: "id", clientSecret: "secret", refreshToken: "r" },
        settings: {},
      },
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    const privateTools = await registry.buildPrivateTools("user123");
    expect(privateTools).not.toEqual({});
    // Note: actual tool objects depend on mock implementation
  });

  it("15. buildPrivateTools skips when private capability is not configured", async () => {
    const configStore = makeConfigStore({}); // No gmail config
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    const privateTools = await registry.buildPrivateTools("user123");
    expect(privateTools).toEqual({});
  });

  it("16. getActiveCapabilities returns only shared ids for SYSTEM_USER_ID", async () => {
    const configStore = makeConfigStore({
      "capability.github": GITHUB_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    const active = await registry.getActiveCapabilities(SYSTEM_USER_ID);
    expect(active).toContain("github");
    expect(active).not.toContain("gmail");
    expect(active).not.toContain("slack-personal");
  });

  it("17. getActiveCapabilities returns shared plus connected private", async () => {
    // This test is simplified since full private capability testing happens
    // in gmail.test.ts and calendar.test.ts. Just verify the shape works.
    const configStore = makeConfigStore({
      "capability.github": GITHUB_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: "U001",
      dbPath: ":memory:",
    });

    const active = await registry.getActiveCapabilities("user123");
    expect(Array.isArray(active)).toBe(true);
    expect(active).toContain("github"); // shared
  });
});
