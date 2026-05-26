/**
 * MCP capability module — loads tools from all user-configured MCP servers.
 *
 * Unlike single-service capabilities (gmail, calendar), this reads multiple
 * per-server configs from UserCapabilityStore and merges their tools with
 * server-namespaced prefixes (mcp_ramp_*, mcp_rippling_*).
 */
import type { ToolSet } from "ai";
import type { ConfigStore } from "../persistence/config.js";
import type { UserCapabilityStore } from "../persistence/user-capabilities.js";
import type { AppLogger } from "../slack/app.js";
import type { CapabilityConfig, PrivateCapability } from "./types.js";
import type { MCPPool } from "../mcp/pool.js";
import { getServerEntry } from "../mcp/catalog.js";

let pool: MCPPool | null = null;

export function setMCPPool(mcpPool: MCPPool): void {
  pool = mcpPool;
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

        const entry = getServerEntry(serverId);
        if (!entry) {
          logger.warn({ serverId }, "MCP server not in catalog");
          continue;
        }

        const serverTools = await pool.acquire(tinoUserId, serverId, entry);

        // Prefix tool names with mcp_{serverId}_
        for (const [toolName, toolDef] of Object.entries(serverTools)) {
          const prefixedName = `mcp_${serverId}_${toolName}`;
          tools[prefixedName] = toolDef;
        }

        logger.info(
          { serverId, toolCount: Object.keys(serverTools).length },
          "loaded MCP server tools",
        );
      } catch (err) {
        logger.warn(
          { serverId, err: (err as Error).message },
          "failed to load MCP server tools",
        );
        continue;
      }
    }

    return Object.keys(tools).length > 0 ? tools : null;
  },
};
