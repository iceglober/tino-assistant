/** How tino reaches an MCP server. `stdio` spawns a local process via npx; the
 *  remote transports connect to a URL. */
export type McpTransport = "stdio" | "streamable-http" | "sse";

/** How a remote MCP server authenticates. The token is stored (encrypted) under
 *  `credentials.token`; `none` sends no auth header. */
export interface McpAuth {
  kind: "none" | "bearer" | "header";
  /** For `header`: the header name the token is sent under (e.g. "X-Api-Key"). */
  headerName?: string;
}

export interface McpServerEntry {
  /** Stable ID used in config keys, e.g. "ramp", "rippling" */
  id: string;
  /** Display name for the console */
  displayName: string;
  /** Transport. Defaults to `stdio` when omitted (catalog npx servers). */
  transport?: McpTransport;
  /** Remote transports only: the server endpoint URL (must be https). */
  url?: string;
  /** Remote transports only: how to authenticate. */
  auth?: McpAuth;
  /** npm package name — spawned via npx (stdio transport only) */
  package?: string;
  /** Optional CLI args after the package */
  args?: string[];
  /** Env var mappings: maps credential keys to the env var the server expects.
   *  e.g. { apiKey: "RAMP_API_KEY" } means config.credentials.apiKey -> env.RAMP_API_KEY */
  envMap?: Record<string, string>;
  /** Console-side field schema for credential entry. Empty for synthesized custom servers. */
  fields: Array<{
    key: string;
    label: string;
    secret?: boolean;
    placeholder?: string;
    optional?: boolean;
  }>;
  /** Short description for the catalog UI */
  description?: string;
  /** Icon emoji for the console */
  icon?: string;
}

// Research findings (wave 2.1 - verified 2026-05-25):
// ✅ Both servers confirmed as Node.js npm packages on npmjs.com
//
// RAMP:
//   npm package: mcp-ramp (https://github.com/dragonkhoi/ramp-mcp)
//   runtime: Node.js ✅
//   env vars: RAMP_API_KEY (API key), RAMP_CLIENT_ID (client ID)
//   installation: npx -y mcp-ramp
//
// RIPPLING:
//   npm package: rippling-mcp-server (https://github.com/bifrost-mcp/rippling-mcp)
//   runtime: Node.js 18+ ✅
//   env vars: RIPPLING_API_TOKEN (required), RIPPLING_BASE_URL (optional, defaults to https://api.rippling.com/platform/api)
//   installation: npx -y rippling-mcp-server

export const MCP_CATALOG: McpServerEntry[] = [
  {
    id: "ramp",
    displayName: "Ramp",
    package: "mcp-ramp",
    envMap: {
      clientId: "RAMP_CLIENT_ID",
      clientSecret: "RAMP_CLIENT_SECRET",
      env: "RAMP_ENV",
    },
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        secret: true,
        placeholder: "Enter your Ramp Client ID",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        secret: true,
        placeholder: "Enter your Ramp Client Secret",
      },
      {
        key: "env",
        label: "Environment",
        placeholder: "demo or prd",
        optional: true,
      },
    ],
    description: "Connect to Ramp for spend management and employee expenses",
    icon: "💳",
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
        label: "Base URL",
        placeholder: "https://api.rippling.com/platform/api",
        optional: true,
      },
    ],
    description: "Connect to Rippling for employee and payroll management",
    icon: "👥",
  },
];

export function getServerEntry(id: string): McpServerEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
