/**
 * Connections to remote MCP servers. Tools are rebuilt on every agent turn, so
 * clients are cached per server config and closed after an idle period. A
 * server that fails to connect is skipped (and remembered as down for a minute)
 * so one dead server never stalls a reply.
 */
import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { mcpUrlProblem } from "@tino/core/domain/mcp";
import type { Logger } from "@tino/core/ports/outbound";
import type { StoredMcpServer } from "./store.js";

type Client = Awaited<ReturnType<typeof createMCPClient>>;

interface Entry {
  client: Client;
  tools: ToolSet;
  timer: ReturnType<typeof setTimeout>;
}

export interface McpClientPool {
  /** The server's tools (raw names), or null when it can't be reached. */
  tools(owner: string, server: StoredMcpServer): Promise<ToolSet | null>;
  /** Connect, list tool names, disconnect. Throws with a readable message on failure. */
  probe(server: StoredMcpServer): Promise<string[]>;
  /** Drop a cached connection (after the server is edited or removed). */
  evict(owner: string, serverId: string): Promise<void>;
  closeAll(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 10_000;
const DOWN_TTL_MS = 60_000;

function headersFor(server: StoredMcpServer): Record<string, string> {
  if (!server.token || server.auth.kind === "none") return {};
  if (server.auth.kind === "bearer") return { Authorization: `Bearer ${server.token}` };
  return { [server.auth.headerName]: server.token };
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function connect(server: StoredMcpServer): Promise<{ client: Client; tools: ToolSet }> {
  const problem = mcpUrlProblem(server.url);
  if (problem) throw new Error(problem);
  const client = await withTimeout(
    createMCPClient({
      clientName: "tino",
      // Redirects are refused so an allowed host can't bounce us to an internal one.
      transport: { type: server.transport, url: server.url, headers: headersFor(server), redirect: "error" },
    }),
    CONNECT_TIMEOUT_MS,
    "connecting",
  );
  try {
    const tools = (await withTimeout(client.tools(), CONNECT_TIMEOUT_MS, "listing tools")) as ToolSet;
    return { client, tools };
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

export function createMcpClientPool(opts: { logger: Logger; idleMs?: number }): McpClientPool {
  const { logger } = opts;
  const idleMs = opts.idleMs ?? 5 * 60_000;
  const live = new Map<string, Entry>();
  const down = new Map<string, number>();

  // The key includes everything that changes the connection, so an edit simply
  // misses the cache; evict() cleans up the stale entry.
  const keyOf = (owner: string, s: StoredMcpServer): string =>
    [owner, s.id, s.url, s.transport, JSON.stringify(s.auth), s.token ?? ""].join("\u0000");

  const close = async (key: string): Promise<void> => {
    const entry = live.get(key);
    if (!entry) return;
    live.delete(key);
    clearTimeout(entry.timer);
    await entry.client.close().catch(() => {});
  };

  const arm = (key: string): ReturnType<typeof setTimeout> => {
    const t = setTimeout(() => void close(key), idleMs);
    t.unref?.();
    return t;
  };

  return {
    async tools(owner, server) {
      const key = keyOf(owner, server);
      const cached = live.get(key);
      if (cached) {
        clearTimeout(cached.timer);
        cached.timer = arm(key);
        return cached.tools;
      }
      const downAt = down.get(key);
      if (downAt && Date.now() - downAt < DOWN_TTL_MS) return null;

      try {
        const { client, tools } = await connect(server);
        live.set(key, { client, tools, timer: arm(key) });
        down.delete(key);
        logger.info(
          { server: server.id, scope: server.scope, tools: Object.keys(tools).length },
          "mcp server connected",
        );
        return tools;
      } catch (err) {
        down.set(key, Date.now());
        logger.warn({ server: server.id, scope: server.scope, err: (err as Error).message }, "mcp server unavailable");
        return null;
      }
    },

    async probe(server) {
      const { client, tools } = await connect(server);
      await client.close().catch(() => {});
      return Object.keys(tools);
    },

    async evict(owner, serverId) {
      const prefix = `${owner}\u0000${serverId}\u0000`;
      for (const key of [...live.keys()]) if (key.startsWith(prefix)) await close(key);
      for (const key of [...down.keys()]) if (key.startsWith(prefix)) down.delete(key);
    },

    async closeAll() {
      await Promise.all([...live.keys()].map(close));
    },
  };
}
