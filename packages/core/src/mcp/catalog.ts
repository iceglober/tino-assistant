export interface McpServerEntry {
  /** Stable ID used in config keys, e.g. "ramp", "rippling" */
  id: string;
  /** Display name for the console */
  displayName: string;
  /** npm package name — spawned via npx */
  package?: string;
  /** Optional CLI args after the package */
  args?: string[];
  /** Env var mappings: maps credential keys to the env var the server expects.
   *  e.g. { apiKey: "RAMP_API_KEY" } means config.credentials.apiKey -> env.RAMP_API_KEY */
  envMap?: Record<string, string>;
  /** Console-side field schema for credential entry */
  fields: Array<{
    key: string;
    label: string;
    secret?: boolean;
    placeholder?: string;
  }>;
  /** Short description for the catalog UI */
  description?: string;
  /** Icon emoji for the console */
  icon?: string;
}

// Research findings (wave 2.1):
//
// RIPPLING (✅ APPROVED — Node.js runtime):
//   npm package: rippling-mcp-server@0.1.0 (https://github.com/bifrost-mcp/rippling-mcp)
//   deps: @modelcontextprotocol/sdk ^1.26.0, zod ^3.23.0
//   env vars: RIPPLING_API_TOKEN (required), RIPPLING_BASE_URL (optional, defaults to https://api.rippling.com/platform/api)
//   installation: npx rippling-mcp-server
//
// RAMP (❌ BLOCKED — Python runtime, NOT Node.js):
//   NOT an npm package; uses uv (Python package manager)
//   repo: https://github.com/ramp-public/ramp-mcp (100% Python codebase)
//   env vars: RAMP_CLIENT_ID, RAMP_CLIENT_SECRET, RAMP_ENV (optional: demo|prd)
//   installation: uv run ramp-mcp
//   CONSTRAINT VIOLATION: Requirement stated "confirmed Node.js runtime (not Python)"
//   ACTION: Research alternative Ramp Node.js wrapper or defer Ramp until official npm package exists

export const MCP_CATALOG: McpServerEntry[] = [
  {
    id: "example-server",
    displayName: "Example MCP Server",
    description: "Sample MCP server for testing",
    fields: [],
  },
  {
    id: "rippling",
    displayName: "Rippling",
    package: "rippling-mcp-server",
    envMap: {
      apiToken: "RIPPLING_API_TOKEN",
      baseUrl: "RIPPLING_BASE_URL",
    },
    fields: [
      {
        key: "apiToken",
        label: "API Token",
        secret: true,
        placeholder: "Enter your Rippling API token",
      },
      {
        key: "baseUrl",
        label: "Base URL (optional)",
        placeholder: "https://api.rippling.com/platform/api",
      },
    ],
    description: "Connect to Rippling for employee and payroll management",
    icon: "👥",
  },
];

export function getServerEntry(id: string): McpServerEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
