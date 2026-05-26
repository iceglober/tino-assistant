/**
 * Integration test: multi-user per-user toolset isolation.
 *
 * Simulates two users (bot owner + teammate) each DMing tino. Verifies that
 * buildPrivateTools returns the correct toolset for each user — the owner's
 * gmail tools are never visible to the teammate, and vice versa.
 *
 * This exercises the real initCapabilityRegistry code path with a mocked
 * UserCapabilityStore that returns different configs per user.
 */

import { describe, expect, it, vi } from "vitest";

// Mock MCPPool before importing registry
vi.mock("../../src/mcp/pool.js", () => ({
  MCPPool: vi.fn(function () {
    return {
      killAll: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      killUser: vi.fn(async () => {}),
      acquire: vi.fn(async () => ({})),
    };
  }),
}));
import { initCapabilityRegistry } from "../../src/capabilities/registry.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { UserCapabilityStore } from "../../src/persistence/user-capabilities.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { SYSTEM_USER_ID } from "../../src/identity/types.js";

const ownerUserId = "tino-uuid-owner";
const teammateUserId = "tino-uuid-teammate";

const gmailConfig: CapabilityConfig = {
  enabled: true,
  credentials: {
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    refreshToken: "fake-refresh-token",
  },
  settings: {},
};

const makeConfigStore = (): ConfigStore =>
  ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getTyped: vi.fn().mockResolvedValue(null),
  }) as unknown as ConfigStore;

const makeUserCapabilityStore = (): UserCapabilityStore => {
  const store: Record<string, Record<string, CapabilityConfig>> = {
    [ownerUserId]: {
      gmail: gmailConfig,
    },
  };

  return {
    get: vi.fn(async (userId: string, capabilityId: string) => {
      return store[userId]?.[capabilityId] ?? null;
    }),
    set: vi.fn(),
    list: vi.fn(async (userId: string) => {
      const caps = store[userId] ?? {};
      return Object.entries(caps).map(([capabilityId, config]) => ({
        capabilityId,
        enabled: config.enabled,
      }));
    }),
    delete: vi.fn().mockResolvedValue(false),
  };
};

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("Wave 3 multi-user toolset isolation", () => {
  it("bot owner DM uses bot owner's private tools", async () => {
    const registry = await initCapabilityRegistry({
      configStore: makeConfigStore(),
      logger: logger as any,
      allowedUserId: "U_OWNER",
      userCapabilities: makeUserCapabilityStore(),
    });

    const tools = await registry.buildPrivateTools(ownerUserId);
    const toolNames = Object.keys(tools);

    expect(toolNames.length).toBeGreaterThan(0);
    expect(toolNames).toContain("gmail_search");
    expect(toolNames).toContain("gmail_get_message");
  });

  it("teammate DM uses teammate's private tools (empty until they configure)", async () => {
    const registry = await initCapabilityRegistry({
      configStore: makeConfigStore(),
      logger: logger as any,
      allowedUserId: "U_OWNER",
      userCapabilities: makeUserCapabilityStore(),
    });

    const tools = await registry.buildPrivateTools(teammateUserId);
    const toolNames = Object.keys(tools);

    // No private capability tools, but per-user tools (preferences, tasks, discovery) present
    expect(toolNames).not.toContain("gmail_search");
    expect(toolNames).toContain("set_preference");
    expect(toolNames).toContain("update_discovery");
  });

  it("teammate's gmail tools never appear in bot owner's runs", async () => {
    const userCaps = makeUserCapabilityStore();
    const teammateGmail: CapabilityConfig = {
      enabled: true,
      credentials: {
        clientId: "teammate-client-id",
        clientSecret: "teammate-client-secret",
        refreshToken: "teammate-refresh-token",
      },
      settings: {},
    };
    (userCaps.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (userId: string, capabilityId: string) => {
        if (userId === ownerUserId && capabilityId === "gmail") return gmailConfig;
        if (userId === teammateUserId && capabilityId === "gmail") return teammateGmail;
        return null;
      },
    );

    const registry = await initCapabilityRegistry({
      configStore: makeConfigStore(),
      logger: logger as any,
      allowedUserId: "U_OWNER",
      userCapabilities: userCaps,
    });

    const ownerTools = await registry.buildPrivateTools(ownerUserId);
    const teammateTools = await registry.buildPrivateTools(teammateUserId);

    expect(Object.keys(ownerTools)).toContain("gmail_search");
    expect(Object.keys(teammateTools)).toContain("gmail_search");

    // Both have gmail tools, but they're distinct function instances
    // (built from different credentials)
    expect(ownerTools.gmail_search).not.toBe(teammateTools.gmail_search);
  });

  it("SYSTEM_USER_ID gets empty private toolset", async () => {
    const registry = await initCapabilityRegistry({
      configStore: makeConfigStore(),
      logger: logger as any,
      allowedUserId: "U_OWNER",
      userCapabilities: makeUserCapabilityStore(),
    });

    const tools = await registry.buildPrivateTools(SYSTEM_USER_ID);
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it("getActiveCapabilities reflects per-user state", async () => {
    const registry = await initCapabilityRegistry({
      configStore: makeConfigStore(),
      logger: logger as any,
      allowedUserId: "U_OWNER",
      userCapabilities: makeUserCapabilityStore(),
    });

    const ownerCaps = await registry.getActiveCapabilities(ownerUserId);
    const teammateCaps = await registry.getActiveCapabilities(teammateUserId);
    const systemCaps = await registry.getActiveCapabilities(SYSTEM_USER_ID);

    expect(ownerCaps).toContain("gmail");
    expect(teammateCaps).not.toContain("gmail");
    expect(systemCaps).not.toContain("gmail");
  });
});
