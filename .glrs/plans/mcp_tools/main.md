# Per-User MCP Tool Servers

## Problem

tino's capabilities are hardcoded TypeScript modules. Adding a new integration (Ramp, Rippling, Notion, etc.) requires writing a capability module, tool wrappers, and redeploying. Users can't connect their own tools.

MCP (Model Context Protocol) is the standard for tool servers. Most MCP servers today are stdio-based (npm packages that run as child processes). tino runs in ECS, so it can spawn these processes — but needs lifecycle management, per-user credential isolation, and a way to surface the tools in the existing `buildPrivateTools` pipeline.

## Approach: Curated Catalog

Pre-install known MCP server packages in the Docker image. Users pick from the catalog in the console, enter their credentials (API keys), and tino spawns the server process with those credentials on demand.

Why catalog-first:
- Security: you vet what runs in your container
- Reliability: known packages, tested versions, predictable behavior
- Simplicity: adding a server is a one-line catalog entry + Dockerfile dependency
- Escape hatch: HTTP transport servers don't need the catalog (just a URL + auth)

## Key Decisions

**`@ai-sdk/mcp` over raw `@modelcontextprotocol/sdk`**: The AI SDK wrapper converts MCP tool definitions directly into `ToolSet` objects compatible with `generateText`. No manual JSON Schema-to-Zod conversion needed. One `client.tools()` call returns everything.

**Stdio process pool**: MCP server processes are long-lived. Spawning one per `buildPrivateTools` call (every DM) would be too slow (~1-2s startup). A process pool keyed by `(userId, serverId)` keeps processes alive across messages and reaps them on idle timeout.

**Private capability scope**: MCP servers are per-user (each user provides their own API keys). They go through `buildPrivateTools`, same as Gmail/Calendar.

## Architecture

```
Console UI                    Server                          ECS Container
-----------                   ------                          -------------
[Catalog]  -- POST config --> UserCapabilityStore              
                              (mcp.ramp: { apiKey, ... })     
                                                              
[Slack DM] --------> buildPrivateTools(userId) ----+          
                                                   |          
                              McpProcessPool  <----+          
                              .getOrSpawn(userId, "ramp")     
                                  |                           
                                  v                           
                              StdioClientTransport            
                              spawn("npx", ["@ramp/mcp"])     
                              env: { RAMP_API_KEY: "..." }    
                                  |                           
                                  v                           
                              createMCPClient(transport)      
                              client.tools() --> ToolSet      
```

## Waves

| Wave | Scope | Files |
|------|-------|-------|
| [0](wave_0.md) | Process pool + MCP capability module | 4 new, 3 modified |
| [1](wave_1.md) | Console UI: catalog browser + credential entry | 3 new/modified |
| [2](wave_2.md) | First catalog entries (Ramp, Rippling) + Dockerfile | 3 modified |

## Verification

1. Add Ramp MCP server to catalog, provide API key in console
2. DM tino "list my recent Ramp transactions" -- tino uses the MCP tool
3. Wait for idle timeout -- process reaped, logs confirm
4. DM again -- process re-spawned transparently
5. Second user configures same server with different API key -- isolated processes
6. Remove server in console -- process killed, tools no longer available
