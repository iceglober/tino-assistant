/**
 * CloudWatch log group allowlist helpers.
 *
 * The allowlist is no longer a module-level constant — it is read from the
 * ConfigStore at tool-construction time and passed into each function.
 * This makes the allowlist runtime-configurable via the web console.
 *
 * Pattern matches src/tools/cloudwatch/validator.ts (allowlist as parameter).
 */
import type { ConfigStore } from "../../persistence/config.js";

/**
 * Read the allowed log groups from the config store.
 * Config key: "cloudwatch.log_groups" — value is a JSON array of strings.
 * Falls back to an empty array if not configured (fail-closed).
 */
export async function getAllowedLogGroups(config: ConfigStore): Promise<readonly string[]> {
  return config.getTyped<string[]>("cloudwatch.log_groups", []);
}

/** Human-readable list for error messages. */
export function describeLogGroupAllowlist(allowedLogGroups: readonly string[]): string {
  if (allowedLogGroups.length === 0) {
    return "(none — add via the config console at http://localhost:3001)";
  }
  return allowedLogGroups.join(", ");
}
