/**
 * Time helpers for Slack tool params. Slack's conversations APIs take epoch
 * seconds ("1753372800.000000"); the model is more reliable with ISO dates —
 * accept either and normalize.
 */

/**
 * Convert a model-supplied time into a Slack ts string (epoch seconds).
 * Accepts a Slack ts ("1753372800", "1753372800.000123"), an ISO date/datetime
 * ("2026-07-01", "2026-07-01T12:00:00Z"), or anything Date.parse understands.
 * Returns undefined for absent/unparseable input (tool omits the param).
 */
export function toSlackTs(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (/^\d{9,}(\.\d+)?$/.test(trimmed)) return trimmed; // already epoch seconds
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return undefined;
  return String(Math.floor(ms / 1000));
}
