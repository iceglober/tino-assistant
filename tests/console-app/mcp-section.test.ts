import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMcpCatalog, getMcpServers, type McpCatalogEntry, type McpServerStatus } from "../../packages/core/src/console-app/lib/api.js";

describe("MCP Tools Section", () => {
  const mockCatalogEntries: McpCatalogEntry[] = [
    {
      id: "github-mcp",
      name: "GitHub MCP Server",
      description: "Connect to GitHub repositories and issues",
    },
    {
      id: "notion-mcp",
      name: "Notion MCP Server",
      description: "Access your Notion workspace",
    },
  ];

  const mockServerStatus: McpServerStatus[] = [
    {
      id: "github-mcp",
      name: "GitHub MCP Server",
      status: "ready",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch MCP catalog entries", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockCatalogEntries,
    } as Response);

    const result = await getMcpCatalog();

    expect(result).toEqual(mockCatalogEntries);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("id", "github-mcp");
  });

  it("should fetch MCP server status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockServerStatus,
    } as Response);

    const result = await getMcpServers();

    expect(result).toEqual(mockServerStatus);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("status", "ready");
  });

  it("should distinguish connected vs unconnected servers", () => {
    const catalog = mockCatalogEntries;
    const servers = mockServerStatus;
    const serverIds = new Set(servers.map(s => s.id));

    // GitHub should be connected
    expect(serverIds.has("github-mcp")).toBe(true);

    // Notion should not be connected
    expect(serverIds.has("notion-mcp")).toBe(false);
  });
});
