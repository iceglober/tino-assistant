# Wave 0: MCP Process Pool + Capability Module

## Goal

Build the infrastructure that spawns stdio MCP server processes per-user, keeps them alive across messages, and exposes their tools through `buildPrivateTools`.

## Dependencies

```bash
bun add @ai-sdk/mcp @modelcontextprotocol/sdk
```

## Items

### 0a. MCP server catalog

**New file:** `src/mcp/catalog.ts`

Static registry of known MCP servers. Each entry defines:

```typescript
export interface McpServerEntry {
  /** Stable ID used in config keys, e.g. "ramp", "rippling" */
  id: string;
  /** Display name for the console */
  displayName: string;
  /** npm package name — spawned via npx */
  package: string;
  /** Optional CLI args after the package */
  args?: string[];
  /** Env var mappings: maps credential keys to the env var the server expects.
   *  e.g. { apiKey: "RAMP_API_KEY" } means config.credentials.apiKey -> env.RAMP_API_KEY */
  envMap: Record<string, string>;
  /** Console-side field schema for credential entry */
  fields: Array<{
    key: string;
    label: string;
    secret?: boolean;
    placeholder?: string;
  }>;
  /** Short description for the catalog UI */
  description: string;
  /** Icon emoji for the console */
  icon: string;
}

export const MCP_CATALOG: McpServerEntry[] = [
  // Populated in wave 2
];
```

Export a lookup function: `getServerEntry(id: string): McpServerEntry | undefined`.

### 0b. MCP process pool

**New file:** `src/mcp/pool.ts`

Manages long-lived MCP client connections keyed by `(userId, serverId)`.

```typescript
export interface McpProcessPool {
  /** Get or create an MCP client for this user+server combo.
   *  Spawns the process if not running. Resets idle timer on access. */
  acquire(userId: string, serverId: string, env: Record<string, string>): Promise<McpPoolEntry>;
  /** Kill a specific user+server process (e.g. on credential removal). */
  kill(userId: string, serverId: string): Promise<void>;
  /** Kill all processes for a user (e.g. on user deprovisioning). */
  killUser(userId: string): Promise<void>;
  /** Kill all processes. Called on shutdown. */
  killAll(): Promise<void>;
}

interface McpPoolEntry {
  tools: ToolSet;
  lastAccessed: number;
}
```

Implementation:
- Internal `Map<string, { client: MCPClient; timer: NodeJS.Timeout; tools: ToolSet }>` keyed by `${userId}:${serverId}`
- On `acquire`: if entry exists and process is alive, reset idle timer and return cached tools. Otherwise spawn new process via `createMCPClient` with `StdioClientTransport`, call `client.tools()`, cache the result.
- Idle timeout: 10 minutes. On timeout, call `client.close()` (kills the child process) and delete the entry.
- On `kill`: call `client.close()`, clear timer, delete entry.
- Wrap `createMCPClient` in a try/catch — if the process crashes on startup, return a clear error (bad credentials, missing package, etc.) instead of leaving a zombie entry.
- Log process spawn and reap events at `info` level.

Key detail: `createMCPClient` from `@ai-sdk/mcp` accepts a raw `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio`. The transport takes `{ command, args, env }`. The pool resolves command/args from the catalog entry and injects the user's credentials into env via the entry's `envMap`.

```typescript
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";

const transport = new StdioClientTransport({
  command: "npx",
  args: [entry.package, ...(entry.args ?? [])],
  env: { ...getDefaultEnvironment(), ...userEnv },
});
const client = await createMCPClient({ transport });
const tools = await client.tools();
```

### 0c. MCP capability module

**New file:** `src/capabilities/mcp.ts`

A single `PrivateCapability` that handles all MCP servers for a user. Unlike Gmail/Calendar (one capability per service), this is one capability that dynamically loads tools from all of the user's configured MCP servers.

```typescript
export const mcpCapability: PrivateCapability = {
  id: "mcp",
  displayName: "MCP Tools",
  scope: "private",

  async buildToolsForUser(tinoUserId, config, configStore, logger): Promise<ToolSet | null> {
    // 1. Read all mcp.* keys from UserCapabilityStore for this user
    // 2. For each enabled server:
    //    a. Look up catalog entry
    //    b. Map credentials to env vars via envMap
    //    c. pool.acquire(userId, serverId, env)
    //    d. Merge returned tools (prefixed with server id to avoid collisions)
    // 3. Return merged toolset or null if none configured
  },
};
```

Tool name prefixing: MCP tools are namespaced as `mcp_{serverId}_{toolName}` to avoid collisions with built-in tools and between servers. Example: `mcp_ramp_list_transactions`.

The capability does NOT use the standard `config: CapabilityConfig | null` parameter (which reads a single `capability.mcp` blob). Instead it reads per-server configs from UserCapabilityStore under keys like `mcp.ramp`, `mcp.rippling`. This is a departure from the normal pattern — the capability's `buildToolsForUser` needs access to `UserCapabilityStore` directly.

To support this: add `userCapabilities?: UserCapabilityStore` as an optional parameter to `buildToolsForUser` in the `PrivateCapability` interface, and pass it from the registry's `buildPrivateTools` loop.

### 0d. Wire into registry + shutdown

**Modified:** `src/capabilities/all.ts`
- Add `mcpCapability` to `ALL_CAPABILITIES`.

**Modified:** `src/capabilities/registry.ts`
- Create the `McpProcessPool` instance in `initCapabilityRegistry`.
- Pass it to `mcpCapability` via a closure or by attaching it to the capability before registration.
- Pass `userCapabilities` to `buildToolsForUser` calls for private capabilities.
- Add `pool.killAll()` to the registry's `stopAll()` method.

**Modified:** `src/index.ts`
- No changes needed — `stopAll()` already called in `shutdown()`.

### 0e. API route for MCP catalog

**New file:** `src/server/routes/mcp.ts`

```
GET  /api/mcp/catalog          → returns MCP_CATALOG (public shape: id, displayName, description, icon, fields)
GET  /api/mcp/servers           → returns user's configured MCP servers (from UserCapabilityStore)
POST /api/mcp/servers/:id       → save credentials for a server (writes to UserCapabilityStore)
DELETE /api/mcp/servers/:id     → remove a server config + kill pool entry
```

**Modified:** `src/server/index.ts` — mount the route.

## Testing

- Unit test `McpProcessPool`: mock `createMCPClient`, verify spawn/reap/idle-timeout behavior.
- Unit test `mcpCapability.buildToolsForUser`: mock pool, verify tool prefixing, verify null when no servers configured.
- Integration test: configure a mock MCP server (in-process), verify tools appear in `buildPrivateTools` output and are callable.

## Notes

- `npx` caches packages after first run, so subsequent spawns of the same server are fast (~200ms vs ~2s first run). In the Docker image (wave 2) we pre-install the packages, so `npx` resolves from disk every time.
- The 10-minute idle timeout balances memory (each MCP process is a Node.js subprocess) against latency (respawn cost). Can be tuned per-server in the catalog if needed.
- Process crashes mid-conversation: the next `acquire` call detects the dead process, spawns a fresh one, and retries. The user sees a brief delay, not an error.
