# Wave 2: First Catalog Entries + Dockerfile

## Goal

Add Ramp and Rippling MCP servers to the catalog and pre-install them in the Docker image so `npx` resolves from disk (no network fetch at runtime).

## Items

### 2a. Catalog entries

**Modified:** `src/mcp/catalog.ts`

```typescript
export const MCP_CATALOG: McpServerEntry[] = [
  {
    id: "ramp",
    displayName: "Ramp",
    package: "@anthropic/ramp-mcp-server",  // verify actual package name
    envMap: { apiKey: "RAMP_API_KEY" },
    fields: [
      { key: "apiKey", label: "API Key", secret: true, placeholder: "ramp_..." },
    ],
    description: "Expenses, cards, reimbursements",
    icon: "💳",
  },
  {
    id: "rippling",
    displayName: "Rippling",
    package: "@anthropic/rippling-mcp-server",  // verify actual package name
    envMap: { apiKey: "RIPPLING_API_KEY" },
    fields: [
      { key: "apiKey", label: "API Key", secret: true },
    ],
    description: "HR, payroll, employee directory",
    icon: "👥",
  },
];
```

**Note:** The exact npm package names need to be verified. Many MCP servers are published under different orgs. Check:
- https://github.com/anthropics/ramp-mcp-server (or similar)
- https://www.npmjs.com/search?q=ramp%20mcp
- https://github.com/modelcontextprotocol/servers (community catalog)

Some servers may be Python-based (not npm). If so, the catalog entry uses `command: "uvx"` or `command: "python"` instead of `npx`, and the Dockerfile installs Python + the package. Cross that bridge per-server.

### 2b. Dockerfile changes

**Modified:** `Dockerfile`

Pre-install MCP server packages in the deps stage so they're cached in node_modules and `npx` doesn't hit the network at runtime.

```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock* ./
COPY packages/core/package.json ./packages/core/
COPY packages/aws/package.json ./packages/aws/
COPY packages/cli/package.json ./packages/cli/
RUN bun install --frozen-lockfile

# Pre-install MCP server packages for the catalog
RUN npx --yes @anthropic/ramp-mcp-server --version 2>/dev/null || true
RUN npx --yes @anthropic/rippling-mcp-server --version 2>/dev/null || true
```

Alternative (cleaner): add them as dependencies in `packages/core/package.json` under a `"mcpServers"` key or as optional dependencies. Then `bun install` handles them. Downside: they pollute the lockfile. The `npx --yes` approach keeps them isolated.

Better alternative: install them globally in the runner stage:

```dockerfile
FROM oven/bun:1 AS runner
# ... existing setup ...

# Pre-cache MCP server packages (avoids network fetch at runtime)
RUN bun add --global @anthropic/ramp-mcp-server @anthropic/rippling-mcp-server || true
```

### 2c. Verify package names and env vars

Before implementing, verify for each server:
1. Exact npm package name (check npmjs.com)
2. Expected env var names (check server README)
3. Whether it's Node.js or Python-based
4. Whether it needs additional system dependencies (e.g. Python servers need `python3`)

This is a research step, not a code step. The catalog entries above are placeholders.

## Adding Future Servers

To add a new MCP server to the catalog:

1. Add entry to `MCP_CATALOG` in `src/mcp/catalog.ts` (id, package, envMap, fields)
2. Add pre-install line to `Dockerfile`
3. Deploy

No other code changes needed. The pool, capability module, and console UI all derive from the catalog dynamically.

## Testing

1. Deploy with Ramp entry in catalog
2. Open console → Customize → Tools tab → see Ramp in MCP Tools section
3. Click connect → enter API key → save
4. DM tino "show me my recent Ramp transactions"
5. tino spawns the Ramp MCP server, discovers tools, calls the right one
6. Verify the response contains real transaction data
7. Check ECS logs: process spawn event, tool call audit log
8. Wait 10 minutes → verify process reaped
9. DM again → verify re-spawn is transparent
