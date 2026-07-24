/**
 * SSRF guard for user-supplied remote MCP server URLs.
 *
 * A custom remote MCP server is an arbitrary URL the agent will connect to and
 * send credentials to. Without a guard, a user (or a compromised prompt that
 * reaches the console) could point tino at internal services, the cloud metadata
 * endpoint (169.254.169.254), or localhost. We require https and reject any host
 * that resolves to a private, loopback, or link-local range by literal form.
 *
 * This is a literal-host check, not a DNS-resolution check — it blocks the common
 * cases (IP literals, localhost, *.local) cheaply. A determined attacker can still
 * point a public DNS name at a private IP; defense-in-depth (egress firewall) is
 * expected in production. Kept deliberately simple and dependency-free.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

/** True for an IPv4 literal in a private, loopback, link-local, or unspecified range. */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true; // malformed → block
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // unspecified
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

/** True for an IPv6 literal that is loopback, unspecified, link-local (fe80::/10), or unique-local (fc00::/7). */
function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
  // IPv4-mapped (::ffff:a.b.c.d) — defer to the IPv4 check on the embedded literal
  const mapped = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Validate a remote MCP server URL. Throws with a stable, non-leaking error code
 * (usable as an API error string) when the URL is not an acceptable remote target.
 */
export function validateServerUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("mcp_url_invalid");
  }
  if (url.protocol !== "https:") {
    throw new Error("mcp_url_must_be_https");
  }
  const host = url.hostname.toLowerCase();
  if (!host) throw new Error("mcp_url_invalid");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("mcp_url_private_host_blocked");
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new Error("mcp_url_private_host_blocked");
  }
}
