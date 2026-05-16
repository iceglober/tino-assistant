/**
 * Validate a CloudWatch Logs Insights query before sending it to AWS.
 *
 * Allowed: a query that contains a `| stats` clause and runs against an
 * allowlisted log group. Stats queries return aggregate rows, not raw log
 * lines, so they are safe to surface to a model that may relay PHI-adjacent
 * content back to the user.
 *
 * Rejected: queries that could return raw log lines or extract structured
 * fields. Specifically:
 *   - log group not in allowlist
 *   - query missing `| stats`
 *   - query containing `| parse` (extracts arbitrary fields from log bodies)
 *   - query containing `| display` (selects raw fields for output)
 *   - query containing `| unmask` (de-masks redacted fields)
 *   - query containing `| head` (raw row dump)
 *   - query containing `| fields` UNLESS it appears strictly before a `| stats`
 *     pipe (i.e., used purely as a pre-stats projection like `fields @timestamp,
 *     @message | stats count() by bin(1m)`)
 *
 * If accepted: auto-inject `| limit 1000` at the end if no `| limit <N>`
 * is already present. Caps result set size as belt-and-suspenders.
 */
export type ValidatorResult = { ok: true; rewritten: string } | { ok: false; reason: string };

export function validateLogsInsightsQuery(
  query: string,
  logGroupName: string,
  allowlist: readonly string[],
): ValidatorResult {
  // 1. Allowlist check
  if (!allowlist.includes(logGroupName)) {
    return {
      ok: false,
      reason:
        allowlist.length === 0
          ? `log group "${logGroupName}" rejected: allowlist is empty`
          : `log group "${logGroupName}" not in allowlist`,
    };
  }

  // 2. Basic shape: not empty, not absurdly long
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "query is empty" };
  }
  if (trimmed.length > 4096) {
    return { ok: false, reason: "query exceeds 4096 character limit" };
  }

  // 3. Forbidden pipes — case-insensitive, with word boundary on the keyword.
  //    The `\|\s*` prefix matches the pipe + optional whitespace; the keyword
  //    must be followed by a word boundary (so we don't false-match e.g.
  //    `parsed_field` if it appeared in some other context).
  const forbidden = [
    { pattern: /\|\s*parse\b/i, name: "parse" },
    { pattern: /\|\s*display\b/i, name: "display" },
    { pattern: /\|\s*unmask\b/i, name: "unmask" },
    { pattern: /\|\s*head\b/i, name: "head" },
  ];
  for (const { pattern, name } of forbidden) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `query contains forbidden pipe: \`| ${name}\`` };
    }
  }

  // 4. `| fields` is allowed ONLY when it appears strictly before a `| stats` pipe
  //    (i.e., as a pre-stats projection). If `fields` appears anywhere AFTER the
  //    first `stats`, OR if there's no `stats` at all, reject.
  //
  //    Strategy: find the position of the first `stats` clause and the position of
  //    the first `fields` clause. Both may appear as the first clause (no leading
  //    pipe) or after a pipe. We match `(?:^|\|)\s*<keyword>\b` to handle both.
  //
  //    If `fields` exists and `stats` does NOT, reject.
  //    If `fields` exists at a position AFTER `stats`, reject. Otherwise allow.
  const statsMatch = trimmed.match(/(?:^|\|)\s*stats\b/i);
  const fieldsMatch = trimmed.match(/(?:^|\|)\s*fields\b/i);

  // 5. Must have a stats clause
  if (!statsMatch) {
    return {
      ok: false,
      reason: "query must contain a `| stats` clause (raw row dumps not permitted)",
    };
  }

  // 6. fields-after-stats rejection
  if (fieldsMatch && statsMatch.index !== undefined && fieldsMatch.index !== undefined) {
    if (fieldsMatch.index > statsMatch.index) {
      return {
        ok: false,
        reason: "query contains `| fields` after `| stats` (terminal field projection not permitted)",
      };
    }
  }

  // 7. Auto-inject `| limit 1000` if no `| limit <N>` is present.
  const hasLimit = /\|\s*limit\s+\d+/i.test(trimmed);
  const rewritten = hasLimit ? trimmed : `${trimmed} | limit 1000`;

  return { ok: true, rewritten };
}
