/**
 * DynamoDB-backed audit logger.
 *
 * Key pattern: pk=AUDIT#<timestamp>#<userId>, sk=AUDIT
 *
 * Supports TTL for automatic retention (default 90 days).
 * The `ttl` attribute is set to epoch-seconds of expiry; DynamoDB's TTL
 * feature deletes items automatically after that time.
 *
 * Query by userId uses a GSI1: gsi1pk=AUDIT_USER#<userId>, gsi1sk=<timestamp zero-padded>
 */
import {
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from 'dynamodb-toolbox';
import { Entity, item, string, number } from 'dynamodb-toolbox';
import type { AuditEntry, AuditLogger, AuditQueryOptions } from '@tino/core/audit/logger';
import type { TinoTable } from '../persistence/dynamo/client.js';

/** Default retention: 90 days in seconds. */
const DEFAULT_RETENTION_SECONDS = 90 * 24 * 60 * 60;

function createAuditEntity(table: TinoTable) {
  return new Entity({
    name: 'Audit',
    table,
    schema: item({
      pk: string().key(),
      sk: string().key(),
      gsi1pk: string(),
      gsi1sk: string(),
      timestamp: number(),
      userId: string(),
      action: string(),
      toolName: string().optional(),
      capabilityInstanceId: string().optional(),
      inputKeys: string().optional(),   // JSON array stored as string
      durationMs: number().optional(),
      status: string(),
      errorMessage: string().optional(),
      ttl: number().optional(),
    }),
    timestamps: false,
  });
}

/** Zero-pad a millisecond timestamp to 16 digits for lexicographic sort. */
function padTimestamp(ms: number): string {
  return String(ms).padStart(16, '0');
}

export function createDynamoAuditLogger(
  table: TinoTable,
  retentionSeconds = DEFAULT_RETENTION_SECONDS,
): AuditLogger {
  const entity = createAuditEntity(table);

  return {
    async log(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
      const ts = Date.now();
      const ttl = Math.floor(ts / 1000) + retentionSeconds;

      await entity
        .build(PutItemCommand)
        .item({
          pk: `AUDIT#${padTimestamp(ts)}#${entry.userId}`,
          sk: 'AUDIT',
          gsi1pk: `AUDIT_USER#${entry.userId}`,
          gsi1sk: padTimestamp(ts),
          timestamp: ts,
          userId: entry.userId,
          action: entry.action,
          ...(entry.toolName !== undefined ? { toolName: entry.toolName } : {}),
          ...(entry.capabilityInstanceId !== undefined ? { capabilityInstanceId: entry.capabilityInstanceId } : {}),
          ...(entry.inputKeys !== undefined ? { inputKeys: JSON.stringify(entry.inputKeys) } : {}),
          ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
          status: entry.status,
          ...(entry.errorMessage !== undefined ? { errorMessage: entry.errorMessage } : {}),
          ttl,
        })
        .send();
    },

    async query(opts: AuditQueryOptions): Promise<AuditEntry[]> {
      let rawItems: AuditItem[];

      if (opts.userId !== undefined) {
        // Use GSI1 to query by userId
        const { Items = [] } = await table
          .build(QueryCommand)
          .entities(entity)
          .query({
            index: 'gsi1',
            partition: `AUDIT_USER#${opts.userId}`,
            ...(opts.since !== undefined
              ? { range: { gte: padTimestamp(opts.since) } }
              : {}),
          })
          .send();
        rawItems = Items as unknown as AuditItem[];
      } else {
        // Scan — only used for admin queries without a userId filter
        const { Items = [] } = await table
          .build(ScanCommand)
          .entities(entity)
          .options({
            filters: {
              Audit: opts.since !== undefined
                ? { attr: 'timestamp', gte: opts.since }
                : { attr: 'sk', eq: 'AUDIT' },
            },
          })
          .send();
        rawItems = Items as unknown as AuditItem[];
      }

      let entries = rawItems.map(itemToEntry);

      if (opts.action !== undefined) {
        entries = entries.filter(e => e.action === opts.action);
      }

      // Sort newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);

      if (opts.limit !== undefined && opts.limit > 0) {
        entries = entries.slice(0, opts.limit);
      }

      return entries;
    },

    async count(): Promise<number> {
      // Scan with count only — not efficient for large tables but acceptable for compliance dashboard
      const { Items = [] } = await table
        .build(ScanCommand)
        .entities(entity)
        .options({
          filters: {
            Audit: { attr: 'sk', eq: 'AUDIT' },
          },
        })
        .send();
      return Items.length;
    },

    async lastEntryAt(): Promise<number | undefined> {
      // Query GSI1 is not available without a userId; use a scan with limit
      const { Items = [] } = await table
        .build(ScanCommand)
        .entities(entity)
        .options({
          filters: {
            Audit: { attr: 'sk', eq: 'AUDIT' },
          },
        })
        .send();

      if (Items.length === 0) return undefined;
      const timestamps = (Items as unknown as AuditItem[]).map(i => i.timestamp);
      return Math.max(...timestamps);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface AuditItem {
  timestamp: number;
  userId: string;
  action: string;
  toolName?: string;
  capabilityInstanceId?: string;
  inputKeys?: string;
  durationMs?: number;
  status: string;
  errorMessage?: string;
}

function itemToEntry(item: AuditItem): AuditEntry {
  return {
    timestamp: item.timestamp,
    userId: item.userId,
    action: item.action as AuditEntry['action'],
    ...(item.toolName !== undefined ? { toolName: item.toolName } : {}),
    ...(item.capabilityInstanceId !== undefined ? { capabilityInstanceId: item.capabilityInstanceId } : {}),
    ...(item.inputKeys !== undefined
      ? { inputKeys: JSON.parse(item.inputKeys) as string[] }
      : {}),
    ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
    status: item.status as AuditEntry['status'],
    ...(item.errorMessage !== undefined ? { errorMessage: item.errorMessage } : {}),
  };
}
