/**
 * Custom (non-catalog) remote MCP servers are synthesized into an McpServerEntry
 * from the user's stored {url, transport, auth} config.
 */
import { describe, expect, it } from "vitest";
import { synthesizeRemoteEntry } from "../../src/capabilities/mcp.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";

function cfg(settings: Record<string, unknown>): CapabilityConfig {
  return { enabled: true, credentials: { token: "t" }, settings };
}

describe("synthesizeRemoteEntry", () => {
  it("builds a streamable-http entry from stored settings", () => {
    const entry = synthesizeRemoteEntry(
      "acme-docs",
      cfg({
        url: "https://mcp.acme.dev",
        transport: "streamable-http",
        auth: { kind: "bearer" },
        displayName: "Acme Docs",
      }),
    );
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe("acme-docs");
    expect(entry?.displayName).toBe("Acme Docs");
    expect(entry?.transport).toBe("streamable-http");
    expect(entry?.url).toBe("https://mcp.acme.dev");
    expect(entry?.auth).toEqual({ kind: "bearer" });
  });

  it("builds an sse entry and defaults displayName to the id", () => {
    const entry = synthesizeRemoteEntry("x", cfg({ url: "https://s.example.com", transport: "sse" }));
    expect(entry?.transport).toBe("sse");
    expect(entry?.displayName).toBe("x");
    expect(entry?.auth).toEqual({ kind: "none" });
  });

  it("returns null when the transport is stdio or missing (not a custom remote server)", () => {
    expect(synthesizeRemoteEntry("x", cfg({ url: "https://s.example.com", transport: "stdio" }))).toBeNull();
    expect(synthesizeRemoteEntry("x", cfg({ url: "https://s.example.com" }))).toBeNull();
  });

  it("returns null when the url is missing", () => {
    expect(synthesizeRemoteEntry("x", cfg({ transport: "streamable-http" }))).toBeNull();
  });
});
