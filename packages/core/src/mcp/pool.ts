/**
 * MCP process pool that manages stdio MCP server processes per (userId, serverId).
 * Caches client connections and tools, with idle timeout reaping.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolSet } from "ai";
import type { AppLogger } from "../slack/app.js";
import type { McpAuth, McpServerEntry } from "./catalog.js";
import { validateServerUrl } from "./validateServerUrl.js";

interface PoolEntry {
  client: { close: () => Promise<void> };
  timer: NodeJS.Timeout;
  tools: ToolSet;
}

/** Build the HTTP auth headers for a remote MCP server. The token lives (encrypted)
 *  under `credentials.token`; `none`/absent token sends nothing. */
function buildAuthHeaders(auth: McpAuth | undefined, credentials?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = credentials?.token;
  if (!auth || auth.kind === "none" || !token) return headers;
  if (auth.kind === "bearer") headers.Authorization = `Bearer ${token}`;
  else if (auth.kind === "header" && auth.headerName) headers[auth.headerName] = token;
  return headers;
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
    credentials?: Record<string, string>,
  ): Promise<ToolSet> {
    const key = this.getKey(userId, serverId);
    const cached = this.pool.get(key);

    if (cached) {
      this.resetTimer(key);
      return cached.tools;
    }

    try {
      // Dynamic import — @ai-sdk/mcp may not resolve under Bun's module system,
      // so we defer loading until someone actually uses MCP.
      const { createMCPClient } = await import("@ai-sdk/mcp");
      const transport = await this.buildTransport(serverId, entry, credentials);
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

  /**
   * Build the transport for a server based on its declared `transport`. `stdio`
   * spawns an npx process (existing behavior); `streamable-http`/`sse` connect to
   * the server's URL with optional auth headers. Returns an opaque transport the
   * ai-sdk MCP client accepts.
   */
  private async buildTransport(
    serverId: string,
    entry: McpServerEntry,
    credentials?: Record<string, string>,
  ): Promise<Transport> {
    const transport = entry.transport ?? "stdio";

    if (transport === "stdio") {
      const pkg = entry.package;
      if (!pkg) {
        throw new Error(`MCP server "${serverId}" has no package defined`);
      }
      // Map user credentials to env vars using the catalog's envMap.
      const userEnv: Record<string, string> = {};
      if (credentials && entry.envMap) {
        for (const [credKey, envVar] of Object.entries(entry.envMap)) {
          if (credentials[credKey]) userEnv[envVar] = credentials[credKey];
        }
      }
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio");
      const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
        string,
        string
      >;
      return new StdioClientTransport({
        command: "npx",
        args: ["-y", pkg, ...(entry.args ?? [])],
        env: { ...baseEnv, ...userEnv },
      });
    }

    // Remote transports — validate the URL (SSRF guard) before connecting.
    if (!entry.url) {
      throw new Error(`MCP server "${serverId}" has no url`);
    }
    validateServerUrl(entry.url);
    const url = new URL(entry.url);
    const headers = buildAuthHeaders(entry.auth, credentials);

    if (transport === "streamable-http") {
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp");
      return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    }
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse");
    return new SSEClientTransport(url, { requestInit: { headers } });
  }

  /**
   * Connect to a server, list its tools, and immediately close — without caching.
   * Powers the console "Test connection" step before a server is saved. Returns the
   * discovered tool names; throws (validation error code or connection error) on failure.
   */
  async probe(entry: McpServerEntry, credentials?: Record<string, string>): Promise<string[]> {
    const { createMCPClient } = await import("@ai-sdk/mcp");
    const transport = await this.buildTransport(entry.id, entry, credentials);
    const client = (await createMCPClient({ transport })) as {
      tools: () => Promise<ToolSet>;
      close: () => Promise<void>;
    };
    try {
      const tools = await client.tools();
      return Object.keys(tools);
    } finally {
      try {
        await client.close();
      } catch {
        /* ignore close errors on probe */
      }
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
