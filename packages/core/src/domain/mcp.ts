/**
 * Remote MCP servers — the pure rules. A server is either shared across the
 * workspace (an admin adds it, everyone's agent gets its tools) or personal
 * (one user adds it with their own token; only their agent sees it).
 */

export type McpScope = "workspace" | "personal";
export type McpTransport = "http" | "sse";

/** How the token is sent. The token itself is stored encrypted, never here. */
export type McpAuth = { kind: "none" } | { kind: "bearer" } | { kind: "header"; headerName: string };

/**
 * Who may see what a workspace server returns. `asker`: treat results as
 * private to whoever asked, so its tools are only offered where they alone read
 * the reply (DMs, web chat). `workspace`: anyone in the workspace may see them,
 * so its tools are also offered in internal channels. Personal servers are
 * always `asker`.
 */
export type McpResultsVisibleTo = "asker" | "workspace";

export interface McpServer {
  /** Slug, unique per scope: [a-z0-9-], 1–24 chars. Becomes part of tool names. */
  id: string;
  scope: McpScope;
  name: string;
  url: string;
  transport: McpTransport;
  auth: McpAuth;
  enabled: boolean;
  resultsVisibleTo: McpResultsVisibleTo;
}

/** Capability-store key for a server, under its owner (a user id, or `org:<id>` for workspace servers). */
export const mcpCapabilityId = (id: string): string => `mcp.${id}`;

export function isValidMcpId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(id);
}

/**
 * The name the model sees: `mcp_<server>_<tool>`, restricted to the character
 * set and 64-char limit every provider accepts for function names.
 */
export function mcpToolName(serverId: string, toolName: string): string {
  const safe = `mcp_${serverId.replace(/-/g, "_")}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe.slice(0, 64);
}

/**
 * SSRF guard for admin/user-supplied server URLs. The agent connects to this
 * URL from inside the cluster and sends a token to it, so it must be https and
 * must not name a loopback, private, link-local (incl. cloud metadata), or
 * internal host. This checks the literal host only — a public DNS name that
 * resolves to a private IP gets past it; the transport also refuses redirects.
 * Returns an error code, or null when the URL is acceptable.
 */
export function mcpUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "mcp_url_invalid";
  }
  if (url.protocol !== "https:") return "mcp_url_must_be_https";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return "mcp_url_invalid";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return "mcp_url_private_host";
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return "mcp_url_private_host";
  return null;
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if (a > 255 || b > 255 || c > 255 || d > 255) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIPv6(host: string): boolean {
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  if (/^fe[89ab]/.test(host) || /^f[cd]/.test(host)) return true;
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  return mapped?.[1] ? isPrivateIPv4(mapped[1]) : false;
}
