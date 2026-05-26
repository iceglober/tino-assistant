import { describe, it, expect } from "vitest";
import { MCP_CATALOG, getServerEntry } from "../../packages/core/src/mcp/catalog.js";

describe("MCP Catalog", () => {
  it("MCP_CATALOG should be an array", () => {
    expect(Array.isArray(MCP_CATALOG)).toBe(true);
  });

  it("should have McpServerEntry objects with required properties", () => {
    expect(MCP_CATALOG.length).toBeGreaterThan(0);
    const entry = MCP_CATALOG[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("displayName");
    expect(entry).toHaveProperty("fields");
    expect(Array.isArray(entry.fields)).toBe(true);
  });

  it("getServerEntry should return the matching entry by id", () => {
    if (MCP_CATALOG.length > 0) {
      const firstEntry = MCP_CATALOG[0];
      const result = getServerEntry(firstEntry.id);
      expect(result).toEqual(firstEntry);
    }
  });

  it("getServerEntry should return undefined for unknown ids", () => {
    const result = getServerEntry("non-existent-server");
    expect(result).toBeUndefined();
  });
});
