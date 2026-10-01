/**
 * One tool group per enabled MCP server the user may use: the workspace's
 * servers plus their own. Each group says who may see what it returns, so the
 * tool provider only connects to servers whose results the readers may see.
 * Tool names are namespaced `mcp_<server>_<tool>`; unreachable servers add none.
 */
import type { ToolSet } from "ai";
import { MCP_WORKSPACE_OWNER, mcpToolName } from "../../../domain/mcp.js";
import { everyoneInWorkspace, onlyUser } from "../../../domain/who-can-see.js";
import type { McpClientPool } from "../mcp/client-pool.js";
import type { McpServerStore } from "../mcp/store.js";
import type { ToolGroup } from "./provider.js";

export async function mcpToolGroups(
  userId: string,
  deps: { servers: McpServerStore; pool: McpClientPool },
): Promise<ToolGroup[]> {
  const servers = (await deps.servers.listFor(userId)).filter((s) => s.enabled);
  return servers.map((server) => ({
    name: `mcp:${server.scope}:${server.id}`,
    whoCanSeeResults:
      server.scope === "workspace" && server.resultsVisibleTo === "workspace" ? everyoneInWorkspace : onlyUser(userId),
    async build(): Promise<ToolSet> {
      const owner = server.scope === "workspace" ? MCP_WORKSPACE_OWNER : userId;
      const tools = await deps.pool.tools(owner, server);
      const out: ToolSet = {};
      for (const [name, def] of Object.entries(tools ?? {})) out[mcpToolName(server.id, name)] = def;
      return out;
    },
  }));
}
