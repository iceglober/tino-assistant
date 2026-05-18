/**
 * Wave 1 — no-regression test for capability scope split.
 *
 * Verifies that the bot owner's tool surface (sharedTools + buildPrivateTools)
 * remains unchanged after splitting capabilities into shared and private.
 *
 * This is an integration test that exercises the full registry with real
 * capability modules.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initCapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeConfigStore(entries: Record<string, unknown> = {}) {
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

// Shared capability config for the bot owner
const GITHUB_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: "ghp_test_token" },
  settings: { repos: ["org/repo"], defaultRepo: "org/repo" },
};

const LINEAR_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: "lin_api_test_token" },
  settings: { defaultTeamKey: "GEN" },
};

// Note: Gmail, Calendar, and Slack-Personal are private capabilities.
// They are read from the global capability.<id> blob in wave 1 (transitional),
// so we need to configure them the same way as before.
const GMAIL_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {
    clientId: "test-id",
    clientSecret: "test-secret",
    refreshToken: "test-refresh",
  },
  settings: {},
};

const SLACK_PERSONAL_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { userToken: "xoxp-test-token" },
  settings: {},
};

describe("Wave 1 - Capability Scope Split (no-regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bot owner has same tool surface: sharedTools + buildPrivateTools for bot owner ≈ old registry.tools", async () => {
    // Setup: bot owner with mixed shared/private capabilities
    const botOwnerId = "U001";
    const configStore = makeConfigStore({
      "capability.github": GITHUB_CONFIG,
      "capability.linear": LINEAR_CONFIG,
      "capability.gmail": GMAIL_CONFIG,
      "capability.slack-personal": SLACK_PERSONAL_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: botOwnerId,
      dbPath: ":memory:",
    });

    // Wave 1 toolset: shared tools + private tools built for bot owner
    const privateTools = await registry.buildPrivateTools(botOwnerId);
    const wave1Tools = { ...registry.sharedTools, ...privateTools };

    // Verify shared capability tools are in sharedTools
    expect(registry.sharedTools.github_search_code).toBeDefined();
    expect(registry.sharedTools.linear_search_issues).toBeDefined();

    // Verify private capability tools are in the merged toolset (from buildPrivateTools)
    expect(wave1Tools.gmail_search).toBeDefined();
    expect(wave1Tools.gmail_get_message).toBeDefined();
    expect(wave1Tools.slack_search_messages).toBeDefined();
    expect(wave1Tools.slack_read_thread).toBeDefined();
    expect(wave1Tools.slack_list_dms).toBeDefined();
    expect(wave1Tools.slack_read_dm).toBeDefined();

    // Verify slack capability is empty (shared, no tools yet)
    expect(registry.sharedTools.slack_search_messages).toBeUndefined();
    expect(registry.sharedTools.slack_list_dms).toBeUndefined();

    // Preferences tools always available in shared
    expect(registry.sharedTools.set_preference).toBeDefined();
    expect(registry.sharedTools.get_preferences).toBeDefined();
  });

  it("getActiveCapabilities returns both shared and connected private ids for bot owner", async () => {
    const botOwnerId = "U001";
    const configStore = makeConfigStore({
      "capability.github": GITHUB_CONFIG,
      "capability.linear": LINEAR_CONFIG,
      "capability.gmail": GMAIL_CONFIG,
      "capability.slack-personal": SLACK_PERSONAL_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: botOwnerId,
      dbPath: ":memory:",
    });

    const activeCapabilities = await registry.getActiveCapabilities(botOwnerId);

    // Shared (only those with config in the store)
    expect(activeCapabilities).toContain("github");
    expect(activeCapabilities).toContain("linear");
    // slack is shared but has no config entry, so not in activeCapabilities

    // Private (connected)
    expect(activeCapabilities).toContain("gmail");
    expect(activeCapabilities).toContain("slack-personal");
  });
});
