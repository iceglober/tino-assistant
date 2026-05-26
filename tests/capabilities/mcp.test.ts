import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolSet } from "ai";
import type { AppLogger } from "../../packages/core/src/slack/app.js";
import type { ConfigStore } from "../../packages/core/src/persistence/config.js";
import type { UserCapabilityStore } from "../../packages/core/src/persistence/user-capabilities.js";
import type { MCPPool } from "../../packages/core/src/mcp/pool.js";
import type { CapabilityConfig } from "../../packages/core/src/capabilities/types.js";
import type { McpServerEntry } from "../../packages/core/src/mcp/catalog.js";

// Mock the catalog module
const mockCatalogEntries: Record<string, McpServerEntry> = {
  ramp: {
    id: "ramp",
    displayName: "Ramp",
    package: "mcp-ramp",
    fields: [{ key: "apiKey", label: "API Key", secret: true }],
    envMap: { apiKey: "RAMP_API_KEY" },
  },
  rippling: {
    id: "rippling",
    displayName: "Rippling",
    package: "mcp-rippling",
    fields: [{ key: "token", label: "Token", secret: true }],
    envMap: { token: "RIPPLING_TOKEN" },
  },
};

vi.mock("../../packages/core/src/mcp/catalog.js", () => ({
  getServerEntry: vi.fn((id: string) => mockCatalogEntries[id]),
  MCP_CATALOG: Object.values(mockCatalogEntries),
}));

// Create mock logger
const createMockLogger = (): AppLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Create mock config store
const createMockConfigStore = (): ConfigStore => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
});

// Create mock user capability store
const createMockUserCapabilityStore = (): UserCapabilityStore => ({
  get: vi.fn(),
  set: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
});

// Create mock pool
const createMockPool = (): MCPPool => ({
  acquire: vi.fn(),
  kill: vi.fn(),
  killUser: vi.fn(),
  killAll: vi.fn(),
});

describe("MCP Capability", () => {
  let logger: AppLogger;
  let configStore: ConfigStore;
  let userCapabilities: UserCapabilityStore;
  let pool: MCPPool;
  let mcpCapability: any;
  let setMCPPool: any;

  beforeEach(async () => {
    logger = createMockLogger();
    configStore = createMockConfigStore();
    userCapabilities = createMockUserCapabilityStore();
    pool = createMockPool();

    // Import the capability module fresh for each test
    const module = await import("../../packages/core/src/capabilities/mcp.js");
    mcpCapability = module.mcpCapability;
    setMCPPool = module.setMCPPool;
    setMCPPool(pool);
  });

  it("returns null when no MCP servers are configured", async () => {
    // Mock the list to return empty array
    vi.mocked(userCapabilities.list).mockResolvedValue([]);

    const result = await mcpCapability.buildToolsForUser(
      "user123",
      null, // no config blob
      configStore,
      logger,
      userCapabilities,
    );

    expect(result).toBeNull();
  });

  it("returns merged toolset with mcp_{serverId}_{toolName} prefixed keys", async () => {
    const rampTools: ToolSet = {
      list_transactions: {
        description: "List transactions",
        parameters: { type: "object", properties: {} },
      },
    };

    const ripplingTools: ToolSet = {
      get_employee: {
        description: "Get employee",
        parameters: { type: "object", properties: {} },
      },
    };

    // Mock the list to return enabled servers
    vi.mocked(userCapabilities.list).mockResolvedValue([
      { capabilityId: "mcp.ramp", enabled: true },
      { capabilityId: "mcp.rippling", enabled: true },
    ]);

    // Mock the get to return server configs
    vi.mocked(userCapabilities.get).mockImplementation(async (userId, capId) => {
      if (capId === "mcp.ramp") {
        return {
          enabled: true,
          credentials: { apiKey: "test-key" },
          settings: {},
        } as CapabilityConfig;
      }
      if (capId === "mcp.rippling") {
        return {
          enabled: true,
          credentials: { token: "test-token" },
          settings: {},
        } as CapabilityConfig;
      }
      return null;
    });

    // Mock pool.acquire to return tools
    vi.mocked(pool.acquire).mockImplementation(async (userId, serverId) => {
      if (serverId === "ramp") return rampTools;
      if (serverId === "rippling") return ripplingTools;
      throw new Error(`Unknown server: ${serverId}`);
    });

    const result = await mcpCapability.buildToolsForUser(
      "user123",
      null,
      configStore,
      logger,
      userCapabilities,
    );

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("mcp_ramp_list_transactions");
    expect(result).toHaveProperty("mcp_rippling_get_employee");
    expect(Object.keys(result!)).toHaveLength(2);
  });

  it("handles pool.acquire failure for one server without breaking others", async () => {
    const ripplingTools: ToolSet = {
      get_employee: {
        description: "Get employee",
        parameters: { type: "object", properties: {} },
      },
    };

    vi.mocked(userCapabilities.list).mockResolvedValue([
      { capabilityId: "mcp.ramp", enabled: true },
      { capabilityId: "mcp.rippling", enabled: true },
    ]);

    vi.mocked(userCapabilities.get).mockImplementation(async (userId, capId) => {
      if (capId === "mcp.ramp") {
        return {
          enabled: true,
          credentials: { apiKey: "test-key" },
          settings: {},
        } as CapabilityConfig;
      }
      if (capId === "mcp.rippling") {
        return {
          enabled: true,
          credentials: { token: "test-token" },
          settings: {},
        } as CapabilityConfig;
      }
      return null;
    });

    // Ramp fails, rippling succeeds
    vi.mocked(pool.acquire).mockImplementation(async (userId, serverId) => {
      if (serverId === "ramp") throw new Error("Failed to spawn process");
      if (serverId === "rippling") return ripplingTools;
      throw new Error(`Unknown server: ${serverId}`);
    });

    const result = await mcpCapability.buildToolsForUser(
      "user123",
      null,
      configStore,
      logger,
      userCapabilities,
    );

    // Should return tools from rippling even though ramp failed
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("mcp_rippling_get_employee");
    expect(Object.keys(result!)).toHaveLength(1);

    // Should log the error
    expect(logger.warn).toHaveBeenCalled();
  });

  it("passes correct env vars resolved via catalog envMap", async () => {
    const rampTools: ToolSet = {
      list_transactions: {
        description: "List transactions",
        parameters: { type: "object", properties: {} },
      },
    };

    vi.mocked(userCapabilities.list).mockResolvedValue([
      { capabilityId: "mcp.ramp", enabled: true },
    ]);

    vi.mocked(userCapabilities.get).mockImplementation(async (userId, capId) => {
      if (capId === "mcp.ramp") {
        return {
          enabled: true,
          credentials: { apiKey: "secret-key-value" },
          settings: {},
        } as CapabilityConfig;
      }
      return null;
    });

    vi.mocked(pool.acquire).mockResolvedValue(rampTools);

    await mcpCapability.buildToolsForUser(
      "user123",
      null,
      configStore,
      logger,
      userCapabilities,
    );

    // Verify pool.acquire was called with the right entry that has envMap
    expect(pool.acquire).toHaveBeenCalledWith(
      "user123",
      "ramp",
      expect.objectContaining({
        id: "ramp",
        envMap: { apiKey: "RAMP_API_KEY" },
      }),
    );
  });
});
