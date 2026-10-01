/**
 * MCP server configs, kept in the encrypted UserCapabilityStore under
 * `mcp.<id>`: personal servers under the user's id, workspace servers under
 * MCP_WORKSPACE_OWNER. Non-secret fields live in `settings`; the token lives in
 * `credentials.token`, so it is encrypted at rest like every other credential.
 */
import {
  MCP_WORKSPACE_OWNER,
  type McpAuth,
  type McpScope,
  type McpServer,
  type McpTransport,
  mcpCapabilityId,
} from "../../../domain/mcp.js";
import type { UserCapabilityStore } from "../../../ports/outbound.js";

export interface StoredMcpServer extends McpServer {
  token?: string;
}

export interface McpServerStore {
  /** Workspace servers plus this user's personal ones (enabled or not). */
  listFor(userId: string): Promise<StoredMcpServer[]>;
  get(scope: McpScope, userId: string, id: string): Promise<StoredMcpServer | null>;
  save(userId: string, server: StoredMcpServer): Promise<void>;
  remove(scope: McpScope, userId: string, id: string): Promise<boolean>;
}

const ownerOf = (scope: McpScope, userId: string): string => (scope === "workspace" ? MCP_WORKSPACE_OWNER : userId);

export function createMcpServerStore(caps: UserCapabilityStore): McpServerStore {
  async function listOwner(owner: string, scope: McpScope): Promise<StoredMcpServer[]> {
    const rows = await caps.list(owner);
    const out: StoredMcpServer[] = [];
    for (const row of rows) {
      if (!row.capabilityId.startsWith("mcp.")) continue;
      const server = await read(owner, scope, row.capabilityId.slice(4));
      if (server) out.push(server);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function read(owner: string, scope: McpScope, id: string): Promise<StoredMcpServer | null> {
    const cfg = await caps.get(owner, mcpCapabilityId(id));
    if (!cfg) return null;
    const s = cfg.settings ?? {};
    if (typeof s.url !== "string") return null;
    return {
      id,
      scope,
      name: typeof s.name === "string" ? s.name : id,
      url: s.url,
      transport: (s.transport === "sse" ? "sse" : "http") as McpTransport,
      auth: (s.auth as McpAuth | undefined) ?? { kind: "none" },
      enabled: cfg.enabled,
      // Only an explicit "workspace" widens it; personal servers never are.
      resultsVisibleTo: scope === "workspace" && s.resultsVisibleTo === "workspace" ? "workspace" : "asker",
      token: cfg.credentials?.token || undefined,
    };
  }

  return {
    async listFor(userId) {
      const [ws, mine] = await Promise.all([
        listOwner(MCP_WORKSPACE_OWNER, "workspace"),
        listOwner(userId, "personal"),
      ]);
      return [...ws, ...mine];
    },

    get: (scope, userId, id) => read(ownerOf(scope, userId), scope, id),

    async save(userId, server) {
      await caps.set(ownerOf(server.scope, userId), mcpCapabilityId(server.id), {
        enabled: server.enabled,
        credentials: server.token ? { token: server.token } : {},
        settings: {
          name: server.name,
          url: server.url,
          transport: server.transport,
          auth: server.auth,
          resultsVisibleTo: server.resultsVisibleTo,
        },
      });
    },

    remove: (scope, userId, id) => caps.delete(ownerOf(scope, userId), mcpCapabilityId(id)),
  };
}
