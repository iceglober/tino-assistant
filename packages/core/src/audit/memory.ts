/**
 * In-memory audit logger for local dev (SQLite mode).
 *
 * Stores entries in an array. Entries are lost on restart — that's fine for
 * local dev. The interface is identical to the DynamoDB implementation so
 * the rest of the codebase doesn't need to know which backend is in use.
 */
import type { AuditEntry, AuditLogger, AuditQueryOptions } from "./logger.js";

export function createMemoryAuditLogger(): AuditLogger {
  const entries: AuditEntry[] = [];

  return {
    async log(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
      entries.push({ ...entry, timestamp: Date.now() });
    },

    async query(opts: AuditQueryOptions): Promise<AuditEntry[]> {
      let result = entries.slice();

      if (opts.userId !== undefined) {
        result = result.filter((e) => e.userId === opts.userId);
      }
      if (opts.action !== undefined) {
        result = result.filter((e) => e.action === opts.action);
      }
      if (opts.since !== undefined) {
        result = result.filter((e) => e.timestamp >= (opts.since as number));
      }

      // Sort newest first
      result.sort((a, b) => b.timestamp - a.timestamp);

      if (opts.limit !== undefined && opts.limit > 0) {
        result = result.slice(0, opts.limit);
      }

      return result;
    },

    async count(): Promise<number> {
      return entries.length;
    },

    async lastEntryAt(): Promise<number | undefined> {
      if (entries.length === 0) return undefined;
      return Math.max(...entries.map((e) => e.timestamp));
    },
  };
}
