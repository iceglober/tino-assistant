/**
 * MCP capability module — loads tools from all user-configured MCP servers.
 *
 * Unlike single-service capabilities (gmail, calendar), this reads multiple
 * per-server configs from UserCapabilityStore and merges their tools with
 * server-namespaced prefixes (mcp_ramp_*, mcp_rippling_*).
 */
import type { ToolSet } from "ai";
import type { McpAuth, McpServerEntry, McpTransport } from "../mcp/catalog.js";
import { getServerEntry } from "../mcp/catalog.js";
import type { MCPPool } from "../mcp/pool.js";
import type { ConfigStore } from "../persistence/config.js";
import type { UserCapabilityStore } from "../persistence/user-capabilities.js";
import type { AppLogger } from "../slack/app.js";
import type { CapabilityConfig, PrivateCapability } from "./types.js";

let pool: MCPPool | null = null;

export function setMCPPool(mcpPool: MCPPool): void {
  pool = mcpPool;
}

/**
 * Build an `McpServerEntry` for a custom (non-catalog) remote server from its
 * stored per-user config. `url`/`transport`/`auth`/`displayName` live in
 * `settings` (plaintext); the token lives (encrypted) in `credentials.token`.
 * Returns null when the stored config isn't a valid remote server.
 */
export function synthesizeRemoteEntry(serverId: string, config: CapabilityConfig): McpServerEntry | null {
  const s = config.settings ?? {};
  const url = typeof s.url === "string" ? s.url : undefined;
  const transport = s.transport as McpTransport | undefined;
  if (!url || (transport !== "streamable-http" && transport !== "sse")) return null;
  const auth: McpAuth = s.auth && typeof s.auth === "object" ? (s.auth as McpAuth) : { kind: "none" };
  return {
    id: serverId,
    displayName: typeof s.displayName === "string" ? s.displayName : serverId,
    transport,
    url,
    auth,
    fields: [],
  };
}

export const mcpCapability: PrivateCapability = {
  id: "mcp",
  displayName: "MCP Tools",
  scope: "private",

  async buildToolsForUser(
    tinoUserId: string,
    _config: CapabilityConfig | null,
    _configStore: ConfigStore,
    logger: AppLogger,
    userCapabilities?: UserCapabilityStore,
  ): Promise<ToolSet | null> {
    if (!pool) {
      logger.warn("MCP pool not initialized");
      return null;
    }

    if (!userCapabilities) {
      logger.debug("UserCapabilityStore not available");
      return null;
    }

    const serverConfigs = await userCapabilities.list(tinoUserId);
    const mcpServers = serverConfigs.filter((s) => s.capabilityId.startsWith("mcp."));

    if (mcpServers.length === 0) {
      return null;
    }

    const tools: ToolSet = {};

    for (const serverConfig of mcpServers) {
      const serverId = serverConfig.capabilityId.replace(/^mcp\./, "");

      if (!serverConfig.enabled) {
        continue;
      }

      try {
        const config = await userCapabilities.get(tinoUserId, serverConfig.capabilityId);
        if (!config) {
          logger.warn({ serverId }, "MCP server config not found");
          continue;
        }

        // Catalog server (npx/stdio) or a custom remote server synthesized from
        // the user's stored {url, transport, auth} config.
        const entry = getServerEntry(serverId) ?? synthesizeRemoteEntry(serverId, config);
        if (!entry) {
          logger.warn({ serverId }, "MCP server is neither a catalog entry nor a valid custom remote server");
          continue;
        }

        const serverTools = await pool.acquire(tinoUserId, serverId, entry, config.credentials);

        // Prefix tool names with mcp_{serverId}_
        for (const [toolName, toolDef] of Object.entries(serverTools)) {
          const prefixedName = `mcp_${serverId}_${toolName}`;
          tools[prefixedName] = toolDef;
        }

        logger.info({ serverId, toolCount: Object.keys(serverTools).length }, "loaded MCP server tools");
      } catch (err) {
        logger.warn({ serverId, err: (err as Error).message }, "failed to load MCP server tools");
      }
    }

    return Object.keys(tools).length > 0 ? tools : null;
  },
};
