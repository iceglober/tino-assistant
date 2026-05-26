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

export const MCP_CATALOG: McpServerEntry[] = [
  {
    id: "example-server",
    displayName: "Example MCP Server",
    description: "Sample MCP server for testing",
    fields: [],
  },
];

export function getServerEntry(id: string): McpServerEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
