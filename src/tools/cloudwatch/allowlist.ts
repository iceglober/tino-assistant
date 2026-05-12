/**
 * CloudWatch log groups the tool is permitted to query.
 *
 * Adding a log group is a deliberate code change — there is no env-var or
 * runtime override. This makes "what can the agent query?" a git-blame-able
 * question, not a config-spelunking question.
 *
 * Pattern matches `src/tools/github/allowlist.ts` (Phase 4).
 *
 * SHIP STATE: empty. Tool fails-closed on every query until this list is
 * populated. Edit this file, redeploy/restart, only then is the tool useful.
 */
export const ALLOWED_LOG_GROUPS: readonly string[] = [
  // TODO: populate before enabling tool — see plans/tino.md Phase 5
];

/** True iff the given log group is in the allowlist. Exact match (case-sensitive — log group names are case-sensitive in AWS). */
export function isAllowedLogGroup(name: string): boolean {
  return ALLOWED_LOG_GROUPS.includes(name);
}

/** Human-readable list for error messages. */
export function describeLogGroupAllowlist(): string {
  if (ALLOWED_LOG_GROUPS.length === 0) {
    return '(none — edit src/tools/cloudwatch/allowlist.ts to enable)';
  }
  return ALLOWED_LOG_GROUPS.join(', ');
}
