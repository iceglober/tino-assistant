/**
 * Capability → tool-name prefix mapping.
 *
 * Single source of truth used by the Console to compute each capability card's
 * "connected" status from the live `/api/health` `tools` array.
 *
 * Derived from each capability module's `registerTools` in
 * `packages/core/src/capabilities/*.ts`:
 *   github     → `github_*`
 *   linear     → `linear_*`
 *   gmail      → `gmail_*`
 *   calendar   → `calendar_*`
 *   slack      → `slack_*` (search, thread, list_dms, read_dm)
 *   cloudwatch → `cloudwatch_*`
 */
const PREFIXES: Record<string, string[]> = {
  github: ['github_'],
  linear: ['linear_'],
  gmail: ['gmail_'],
  calendar: ['calendar_'],
  slack: ['slack_'],
  cloudwatch: ['cloudwatch_'],
};

/** Returns true if any registered tool name matches a prefix for this capability id. */
export function isCapabilityConnected(id: string, tools: readonly string[]): boolean {
  const prefixes = PREFIXES[id];
  if (!prefixes || prefixes.length === 0) return false;
  return tools.some((t) => prefixes.some((p) => t.startsWith(p)));
}
