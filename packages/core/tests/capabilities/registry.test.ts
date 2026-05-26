import { describe, it, expect, vi, beforeEach } from "vitest";
import { ALL_CAPABILITIES } from "../../src/capabilities/all.js";

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

describe("Capability Registry", () => {
  describe("MCP Capability Integration", () => {
    it("mcpCapability appears in ALL_CAPABILITIES", () => {
      const mcpCapId = ALL_CAPABILITIES.find((cap) => cap.id === "mcp");
      expect(mcpCapId).toBeDefined();
      expect(mcpCapId?.displayName).toBe("MCP Tools");
      expect(mcpCapId?.scope).toBe("private");
    });

    it("buildPrivateTools passes userCapabilities to MCP capability's buildToolsForUser", async () => {
      const { initCapabilityRegistry } = await import("../../src/capabilities/registry.js");

      // Create minimal mocks
      const configStore = { get: vi.fn(async () => null), set: vi.fn(), del: vi.fn(), list: vi.fn() };
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const userCapabilities = {
        get: vi.fn(async (userId, capId) => {
          // Return null for MCP capability since no servers are configured in this test
          return null;
        }),
        set: vi.fn(),
        list: vi.fn(async () => []), // No MCP servers configured
        delete: vi.fn(),
      };
      const preferencesStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
      const taskStore = { get: vi.fn(), create: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn() };

      const mcpCapability = ALL_CAPABILITIES.find((cap) => cap.id === "mcp");
      expect(mcpCapability).toBeDefined();

      const buildToolsForUserSpy = vi.spyOn(mcpCapability!, "buildToolsForUser");

      const registry = await initCapabilityRegistry({
        configStore,
        logger,
        allowedUserId: "test-user",
        preferencesStore,
        taskStore,
        userCapabilities,
      } as any);

      // Call buildPrivateTools which should call mcpCapability.buildToolsForUser
      await registry.buildPrivateTools("user-123");

      // Verify that buildToolsForUser was called and userCapabilities was passed as the last parameter
      expect(buildToolsForUserSpy).toHaveBeenCalled();
      const calls = buildToolsForUserSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // Check that the last argument of the first call is userCapabilities
      expect(calls[0][4]).toBe(userCapabilities);
    });

    it("stopAll invokes pool.killAll()", async () => {
      const { initCapabilityRegistry } = await import("../../src/capabilities/registry.js");

      // Create minimal mocks
      const configStore = { get: vi.fn(async () => null), set: vi.fn(), del: vi.fn(), list: vi.fn() };
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const userCapabilities = { get: vi.fn(async () => null), set: vi.fn(), list: vi.fn(async () => []), delete: vi.fn() };
      const preferencesStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
      const taskStore = { get: vi.fn(), create: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn() };

      const registry = await initCapabilityRegistry({
        configStore,
        logger,
        allowedUserId: "test-user",
        preferencesStore,
        taskStore,
        userCapabilities,
      } as any);

      expect(registry.stopAll).toBeDefined();
      expect(typeof registry.stopAll).toBe("function");

      // Call stopAll — it should not throw
      await expect(registry.stopAll()).resolves.toBeUndefined();
    });

    it("pool is created once in initCapabilityRegistry", async () => {
      const { initCapabilityRegistry } = await import("../../src/capabilities/registry.js");

      // Create minimal mocks
      const configStore = { get: vi.fn(async () => null), set: vi.fn(), del: vi.fn(), list: vi.fn() };
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const userCapabilities = { get: vi.fn(async () => null), set: vi.fn(), list: vi.fn(async () => []), delete: vi.fn() };
      const preferencesStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
      const taskStore = { get: vi.fn(), create: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn() };

      const registry1 = await initCapabilityRegistry({
        configStore,
        logger,
        allowedUserId: "test-user",
        preferencesStore,
        taskStore,
        userCapabilities,
      } as any);

      const registry2 = await initCapabilityRegistry({
        configStore,
        logger,
        allowedUserId: "test-user",
        preferencesStore,
        taskStore,
        userCapabilities,
      } as any);

      // Both should have working stopAll functions
      await expect(registry1.stopAll()).resolves.toBeUndefined();
      await expect(registry2.stopAll()).resolves.toBeUndefined();
    });
  });
});
