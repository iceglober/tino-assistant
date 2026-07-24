/**
 * SSRF guard for user-supplied remote MCP server URLs.
 */
import { describe, expect, it } from "vitest";
import { validateServerUrl } from "../../src/mcp/validateServerUrl.js";

describe("validateServerUrl", () => {
  it("accepts a public https URL", () => {
    expect(() => validateServerUrl("https://mcp.example.com")).not.toThrow();
    expect(() => validateServerUrl("https://mcp.example.com:8443/path")).not.toThrow();
  });

  it("rejects non-https schemes", () => {
    expect(() => validateServerUrl("http://mcp.example.com")).toThrow("mcp_url_must_be_https");
    expect(() => validateServerUrl("ftp://mcp.example.com")).toThrow("mcp_url_must_be_https");
  });

  it("rejects malformed URLs", () => {
    expect(() => validateServerUrl("not a url")).toThrow("mcp_url_invalid");
  });

  it("blocks localhost and loopback", () => {
    for (const u of ["https://localhost", "https://127.0.0.1", "https://[::1]"]) {
      expect(() => validateServerUrl(u)).toThrow("mcp_url_private_host_blocked");
    }
  });

  it("blocks private IPv4 ranges", () => {
    for (const u of [
      "https://10.0.0.5",
      "https://192.168.1.1",
      "https://172.16.4.4",
      "https://172.31.255.255",
      "https://100.64.0.1",
    ]) {
      expect(() => validateServerUrl(u)).toThrow("mcp_url_private_host_blocked");
    }
  });

  it("blocks the cloud metadata / link-local address", () => {
    expect(() => validateServerUrl("https://169.254.169.254")).toThrow("mcp_url_private_host_blocked");
  });

  it("blocks private/link-local IPv6", () => {
    for (const u of ["https://[fd00::1]", "https://[fe80::1]"]) {
      expect(() => validateServerUrl(u)).toThrow("mcp_url_private_host_blocked");
    }
  });

  it("blocks internal-looking hostnames", () => {
    for (const u of ["https://db.internal", "https://printer.local"]) {
      expect(() => validateServerUrl(u)).toThrow("mcp_url_private_host_blocked");
    }
  });

  it("allows public IPs that merely look adjacent to private ranges", () => {
    expect(() => validateServerUrl("https://172.15.0.1")).not.toThrow();
    expect(() => validateServerUrl("https://11.0.0.1")).not.toThrow();
  });
});
