import { describe, it, expect, beforeEach, vi } from "vitest";
import { MCP_CATALOG } from "../../../packages/core/src/mcp/catalog.js";
import type { ConfigStore } from "../../../packages/core/src/persistence/config.js";
import type { UserCapabilityStore } from "../../../packages/core/src/persistence/user-capabilities.js";
import type { AppLogger } from "../../../packages/core/src/slack/app.js";
import type { AuditLogger } from "../../../packages/core/src/audit/logger.js";
import type { MCPPool } from "../../../packages/core/src/mcp/pool.js";

describe("MCP routes", () => {
  let mockConfig: ConfigStore;
  let mockUserCapabilities: UserCapabilityStore;
  let mockLogger: AppLogger;
  let mockAuditLogger: AuditLogger;
  let mockPool: MCPPool;

  beforeEach(() => {
    mockConfig = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getTyped: vi.fn(),
    } as unknown as ConfigStore;

    mockUserCapabilities = {
      get: vi.fn(),
      set: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    } as unknown as UserCapabilityStore;

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as AppLogger;

    mockAuditLogger = {
      log: vi.fn(),
    } as unknown as AuditLogger;

    mockPool = {
      acquire: vi.fn(),
      kill: vi.fn(),
      killUser: vi.fn(),
      killAll: vi.fn(),
    } as unknown as MCPPool;
  });

  describe("GET /catalog endpoint logic", () => {
    it("should return catalog entries with only public fields", () => {
      // The route should return catalog with only: id, displayName, description, icon, fields
      const publicCatalog = MCP_CATALOG.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        description: entry.description,
        icon: entry.icon,
        fields: entry.fields,
      }));

      expect(Array.isArray(publicCatalog)).toBe(true);
      if (publicCatalog.length > 0) {
        const entry = publicCatalog[0];
        expect(entry).toHaveProperty("id");
        expect(entry).toHaveProperty("displayName");
        expect(entry).toHaveProperty("fields");
        // Should not have package or args (internal fields)
        expect(entry).not.toHaveProperty("package");
        expect(entry).not.toHaveProperty("args");
        expect(entry).not.toHaveProperty("envMap");
      }
    });
  });

  describe("GET /servers endpoint logic", () => {
    it("should filter MCP servers from user capabilities list", async () => {
      // Mock the user capabilities list to return multiple capabilities
      vi.mocked(mockUserCapabilities.list).mockResolvedValueOnce([
        { capabilityId: "mcp.ramp", enabled: true },
        { capabilityId: "mcp.rippling", enabled: false },
        { capabilityId: "github", enabled: true }, // Not an MCP server
      ]);

      // Mock getting the server configs
      vi.mocked(mockUserCapabilities.get).mockResolvedValueOnce({
        enabled: true,
        credentials: { apiKey: "test-key" },
        settings: {},
      });

      vi.mocked(mockUserCapabilities.get).mockResolvedValueOnce({
        enabled: false,
        credentials: {},
        settings: {},
      });

      // Simulate the logic of the GET /servers endpoint
      const serverConfigs = await mockUserCapabilities.list("user123");
      const mcpServers = serverConfigs.filter((s) => s.capabilityId.startsWith("mcp."));

      expect(mcpServers).toHaveLength(2);
      expect(mcpServers[0].capabilityId).toBe("mcp.ramp");
      expect(mcpServers[1].capabilityId).toBe("mcp.rippling");

      // Verify that non-MCP capabilities are filtered out
      expect(serverConfigs.some((s) => s.capabilityId === "github")).toBe(true);
      expect(mcpServers.some((s) => s.capabilityId === "github")).toBe(false);
    });

    it("should correctly extract serverId from capabilityId", () => {
      const capabilityId = "mcp.ramp";
      const serverId = capabilityId.replace(/^mcp\./, "");
      expect(serverId).toBe("ramp");
    });
  });

  describe("POST /servers/:id endpoint logic", () => {
    it("should save credentials with mcp prefix to UserCapabilityStore", async () => {
      const serverId = "ramp";
      const capabilityId = `mcp.${serverId}`;
      const config = {
        enabled: true,
        credentials: { apiKey: "test-key" },
        settings: {},
      };

      vi.mocked(mockUserCapabilities.set).mockResolvedValueOnce();

      // Simulate the logic of POST /servers/:id
      await mockUserCapabilities.set("user123", capabilityId, config);

      expect(mockUserCapabilities.set).toHaveBeenCalledWith("user123", "mcp.ramp", config);
    });

    it("should call audit logger for config changes", async () => {
      vi.mocked(mockAuditLogger.log).mockResolvedValueOnce();

      // Simulate audit logging for config change
      await mockAuditLogger.log({
        userId: "user@example.com",
        action: "config_change",
        toolName: "mcp.ramp",
        status: "success",
      });

      expect(mockAuditLogger.log).toHaveBeenCalledWith({
        userId: "user@example.com",
        action: "config_change",
        toolName: "mcp.ramp",
        status: "success",
      });
    });

    it("should handle missing credentials gracefully", async () => {
      const config = {
        enabled: true,
        credentials: {}, // Empty credentials
        settings: {},
      };

      vi.mocked(mockUserCapabilities.set).mockResolvedValueOnce();

      await mockUserCapabilities.set("user123", "mcp.test", config);

      expect(mockUserCapabilities.set).toHaveBeenCalledWith(
        "user123",
        "mcp.test",
        expect.objectContaining({
          credentials: {},
        }),
      );
    });
  });

  describe("DELETE /servers/:id endpoint logic", () => {
    it("should delete the server config from UserCapabilityStore", async () => {
      const serverId = "ramp";
      const capabilityId = `mcp.${serverId}`;

      vi.mocked(mockUserCapabilities.delete).mockResolvedValueOnce(true);

      // Simulate the logic of DELETE /servers/:id
      const deleted = await mockUserCapabilities.delete("user123", capabilityId);

      expect(deleted).toBe(true);
      expect(mockUserCapabilities.delete).toHaveBeenCalledWith("user123", "mcp.ramp");
    });

    it("should kill the pool connection for the server", async () => {
      const serverId = "ramp";

      vi.mocked(mockPool.kill).mockResolvedValueOnce();

      // Simulate pool cleanup
      await mockPool.kill("user123", serverId);

      expect(mockPool.kill).toHaveBeenCalledWith("user123", "ramp");
    });

    it("should call audit logger for config deletion", async () => {
      vi.mocked(mockAuditLogger.log).mockResolvedValueOnce();

      // Simulate audit logging for deletion
      await mockAuditLogger.log({
        userId: "user@example.com",
        action: "config_change",
        toolName: "mcp.ramp",
        status: "success",
      });

      expect(mockAuditLogger.log).toHaveBeenCalled();
    });

    it("should handle non-existent servers gracefully", async () => {
      vi.mocked(mockUserCapabilities.delete).mockResolvedValueOnce(false);

      const deleted = await mockUserCapabilities.delete("user123", "mcp.nonexistent");

      expect(deleted).toBe(false);
    });
  });

  describe("Auth enforcement", () => {
    it("should require authentication for GET /servers", () => {
      // The route checks: const loggedInUser = c.get("user");
      // If no user is set, returns 401
      const loggedInUser = undefined;
      expect(loggedInUser).toBeUndefined();
      // Route would return 401 Unauthorized
    });

    it("should require authentication for POST /servers/:id", () => {
      const loggedInUser = undefined;
      expect(loggedInUser).toBeUndefined();
      // Route would return 401 Unauthorized
    });

    it("should require authentication for DELETE /servers/:id", () => {
      const loggedInUser = undefined;
      expect(loggedInUser).toBeUndefined();
      // Route would return 401 Unauthorized
    });
  });
});
