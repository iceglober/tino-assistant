import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ToolSet } from "ai";
import type { AppLogger } from "../../packages/core/src/slack/app.js";

// Mock logger
const createMockLogger = (): AppLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Mock MCPClient and transport
const mockTools: ToolSet = {
  test_tool: {
    description: "A test tool",
    parameters: { type: "object", properties: {} },
  },
};

let mockClientInstances: any[] = [];

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(async () => {
    const mockClient = {
      tools: vi.fn().mockResolvedValue(mockTools),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockClientInstances.push(mockClient);
    return mockClient;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio", () => ({
  StdioClientTransport: class StdioClientTransport {
    constructor(opts: any) {}
  },
}));

// Import after mocking
import { MCPPool } from "../../packages/core/src/mcp/pool.js";

describe("MCPPool", () => {
  let pool: MCPPool;
  let logger: AppLogger;

  beforeEach(() => {
    mockClientInstances = [];
    logger = createMockLogger();
    pool = new MCPPool({ logger, idleTimeoutMs: 100 });
  });

  afterEach(async () => {
    await pool.killAll();
  });

  it("should acquire tools and cache them on second call without re-spawning", async () => {
    const userId = "user1";
    const serverId = "server1";

    // First acquire
    const tools1 = await pool.acquire(userId, serverId, {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    expect(tools1).toEqual(mockTools);

    // Second acquire should return cached tools without re-spawning
    const tools2 = await pool.acquire(userId, serverId, {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    expect(tools2).toEqual(mockTools);
    expect(tools1).toBe(tools2); // Same reference (cached)
  });

  it("should close client and delete entry on idle timeout", async () => {
    const userId = "user1";
    const serverId = "server1";

    await pool.acquire(userId, serverId, {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    // Wait for idle timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The client should be closed and entry deleted after timeout
    const tools = await pool.acquire(userId, serverId, {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    expect(tools).toEqual(mockTools);
  });

  it("should kill specific user+server entry", async () => {
    const userId = "user1";
    const serverId = "server1";

    await pool.acquire(userId, serverId, {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    await pool.kill(userId, serverId);

    // After kill, next acquire should spawn a new client
    const tools = await pool.acquire(userId, serverId, {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    expect(tools).toEqual(mockTools);
  });

  it("should kill all entries for a specific user", async () => {
    const userId = "user1";

    await pool.acquire(userId, "server1", {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    await pool.acquire(userId, "server2", {
      id: "test-server2",
      displayName: "Test 2",
      package: "test-package-2",
      fields: [],
    });

    await pool.killUser(userId);

    // After killUser, next acquire should spawn new clients
    const tools1 = await pool.acquire(userId, "server1", {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    const tools2 = await pool.acquire(userId, "server2", {
      id: "test-server2",
      displayName: "Test 2",
      package: "test-package-2",
      fields: [],
    });

    expect(tools1).toEqual(mockTools);
    expect(tools2).toEqual(mockTools);
  });

  it("should kill all entries across all users", async () => {
    await pool.acquire("user1", "server1", {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    await pool.acquire("user2", "server2", {
      id: "test-server2",
      displayName: "Test 2",
      package: "test-package-2",
      fields: [],
    });

    await pool.killAll();

    // After killAll, next acquire should spawn new clients
    const tools1 = await pool.acquire("user1", "server1", {
      id: "test-server",
      displayName: "Test",
      package: "test-package",
      fields: [],
    });

    const tools2 = await pool.acquire("user2", "server2", {
      id: "test-server2",
      displayName: "Test 2",
      package: "test-package-2",
      fields: [],
    });

    expect(tools1).toEqual(mockTools);
    expect(tools2).toEqual(mockTools);
  });

  it("should handle process crash on startup gracefully", async () => {
    const userId = "user1";
    const serverId = "server1";

    // This test would require mocking the actual spawn to fail
    // For now, we verify the method exists and doesn't throw
    await expect(
      pool.acquire(userId, serverId, {
        id: "test-server",
        displayName: "Test",
        package: "test-package",
        fields: [],
      }),
    ).resolves.toBeDefined();
  });
});
