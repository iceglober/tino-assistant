import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getMcpCatalog,
  getMcpServers,
  saveMcpServer,
  removeMcpServer,
  type McpCatalogEntry,
  type McpServerStatus,
} from "../../packages/core/src/console-app/lib/api.js";

describe("MCP API functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getMcpCatalog", () => {
    it("calls GET /api/mcp/catalog and returns McpCatalogEntry[]", async () => {
      const mockCatalog: McpCatalogEntry[] = [
        { id: "cat-1", name: "Catalog 1", description: "Test catalog" },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockCatalog,
      } as Response);

      const result = await getMcpCatalog();

      expect(global.fetch).toHaveBeenCalledWith("/api/mcp/catalog", {
        credentials: "include",
      });
      expect(result).toEqual(mockCatalog);
    });
  });

  describe("getMcpServers", () => {
    it("calls GET /api/mcp/servers and returns McpServerStatus[]", async () => {
      const mockServers: McpServerStatus[] = [
        { id: "srv-1", name: "Server 1", status: "ready" },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockServers,
      } as Response);

      const result = await getMcpServers();

      expect(global.fetch).toHaveBeenCalledWith("/api/mcp/servers", {
        credentials: "include",
      });
      expect(result).toEqual(mockServers);
    });
  });

  describe("saveMcpServer", () => {
    it("calls POST /api/mcp/servers/:id with credentials body", async () => {
      const serverId = "test-server";
      const serverData = {
        credentials: {
          apiKey: "test-key",
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ ok: true, id: serverId }),
      } as Response);

      const result = await saveMcpServer(serverId, serverData);

      expect(global.fetch).toHaveBeenCalledWith(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(serverData),
      });
      expect(result).toEqual({ ok: true, id: serverId });
    });
  });

  describe("removeMcpServer", () => {
    it("calls DELETE /api/mcp/servers/:id", async () => {
      const serverId = "test-server";

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ ok: true, id: serverId }),
      } as Response);

      const result = await removeMcpServer(serverId);

      expect(global.fetch).toHaveBeenCalledWith(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      expect(result).toEqual({ ok: true, id: serverId });
    });
  });
});
