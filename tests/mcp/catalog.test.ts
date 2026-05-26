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

  describe("Rippling entry", () => {
    it("should exist with id 'rippling'", () => {
      const entry = getServerEntry("rippling");
      expect(entry).toBeDefined();
      expect(entry?.id).toBe("rippling");
    });

    it("should have correct package, displayName, and description", () => {
      const entry = getServerEntry("rippling");
      expect(entry?.package).toBe("rippling-mcp-server");
      expect(entry?.displayName).toBeDefined();
      expect(entry?.description).toBeDefined();
    });

    it("should have envMap with RIPPLING_API_TOKEN and RIPPLING_BASE_URL", () => {
      const entry = getServerEntry("rippling");
      expect(entry?.envMap).toEqual({
        apiToken: "RIPPLING_API_TOKEN",
        baseUrl: "RIPPLING_BASE_URL",
      });
    });

    it("should have fields including secret fields", () => {
      const entry = getServerEntry("rippling");
      expect(entry?.fields).toBeDefined();
      expect(Array.isArray(entry?.fields)).toBe(true);
      expect(entry!.fields.length).toBeGreaterThanOrEqual(1);
      const secretField = entry!.fields.find((f) => f.secret === true);
      expect(secretField).toBeDefined();
    });

    it("should have an icon emoji", () => {
      const entry = getServerEntry("rippling");
      expect(entry?.icon).toBeDefined();
    });
  });
});
