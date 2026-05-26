/**
 * MCP process pool that manages stdio MCP server processes per (userId, serverId).
 * Caches client connections and tools, with idle timeout reaping.
 */
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import type { ToolSet } from "ai";
import type { AppLogger } from "../slack/app.js";
import type { McpServerEntry } from "./catalog.js";

interface PoolEntry {
  client: Awaited<ReturnType<typeof createMCPClient>>;
  timer: NodeJS.Timeout;
  tools: ToolSet;
}

interface MCPPoolOpts {
  logger: AppLogger;
  idleTimeoutMs?: number;
}

export class MCPPool {
  private pool = new Map<string, PoolEntry>();
  private logger: AppLogger;
  private idleTimeoutMs: number;

  constructor(opts: MCPPoolOpts) {
    this.logger = opts.logger;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 300_000; // 5 minutes default
  }

  private getKey(userId: string, serverId: string): string {
    return `${userId}:${serverId}`;
  }

  private resetTimer(key: string): void {
    const entry = this.pool.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        this.reapEntry(key);
      }, this.idleTimeoutMs);
    }
  }

  private async closeEntry(key: string, action: string): Promise<void> {
    const entry = this.pool.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      try {
        await entry.client.close();
      } catch (err) {
        this.logger.warn({ err, key }, `error closing client on ${action}`);
      }
      this.pool.delete(key);
      this.logger.info({ key }, `${action} MCP connection`);
    }
  }

  private async reapEntry(key: string): Promise<void> {
    await this.closeEntry(key, "reaped idle");
  }

  async acquire(
    userId: string,
    serverId: string,
    entry: McpServerEntry,
  ): Promise<ToolSet> {
    const key = this.getKey(userId, serverId);
    const cached = this.pool.get(key);

    if (cached) {
      this.resetTimer(key);
      return cached.tools;
    }

    try {
      const transport = new StdioClientTransport({
        command: "npx",
        args: [entry.package ?? "", ...(entry.args ?? [])],
        env: {
          ...process.env,
          // TODO: add userEnv from credentials if envMap is provided
        },
      });

      const client = await createMCPClient({ transport });
      const tools = await client.tools();

      const poolEntry: PoolEntry = {
        client,
        timer: setTimeout(() => {
          this.reapEntry(key);
        }, this.idleTimeoutMs),
        tools,
      };

      this.pool.set(key, poolEntry);
      this.logger.info({ userId, serverId, toolCount: Object.keys(tools).length }, "spawned MCP client");

      return tools;
    } catch (err) {
      this.logger.error({ err, userId, serverId }, "failed to spawn MCP client");
      throw err;
    }
  }

  async kill(userId: string, serverId: string): Promise<void> {
    const key = this.getKey(userId, serverId);
    await this.closeEntry(key, "killed");
  }

  async killUser(userId: string): Promise<void> {
    const keys = Array.from(this.pool.keys()).filter((key) => key.startsWith(`${userId}:`));

    for (const key of keys) {
      await this.closeEntry(key, "killed");
    }

    this.logger.info({ userId, count: keys.length }, "killed all MCP connections for user");
  }

  async killAll(): Promise<void> {
    const keys = Array.from(this.pool.keys());

    for (const key of keys) {
      await this.closeEntry(key, "killed");
    }

    this.logger.info({ count: keys.length }, "killed all MCP connections");
  }
}
