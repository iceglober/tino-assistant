import { tool } from 'ai';
import { z } from 'zod';
import {
  StartQueryCommand,
  GetQueryResultsCommand,
  type CloudWatchLogsClient,
  type GetQueryResultsCommandOutput,
} from '@aws-sdk/client-cloudwatch-logs';
import type { AppLogger } from '../../slack/app.js';
import { ALLOWED_LOG_GROUPS, describeLogGroupAllowlist } from './allowlist.js';
import { validateLogsInsightsQuery } from './validator.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const MAX_ROWS_RETURNED = 100;

const inputSchema = z.object({
  logGroupName: z
    .string()
    .min(1)
    .describe('CloudWatch log group name (must be in the allowlist)'),
  query: z
    .string()
    .min(1)
    .describe(
      'CloudWatch Logs Insights query — MUST contain a `| stats` clause; raw field dumps are rejected',
    ),
  startTimeIso: z
    .string()
    .min(1)
    .describe('ISO-8601 start time, e.g. 2026-05-12T10:00:00Z'),
  endTimeIso: z.string().min(1).describe('ISO-8601 end time'),
});

type QueryInput = z.infer<typeof inputSchema>;

type QueryResult =
  | { rowCount: number; rows: Record<string, string | undefined>[]; rewrittenQuery: string }
  | { error: string; message: string };

export interface CloudWatchToolDeps {
  client: CloudWatchLogsClient;
  logger: AppLogger;
  /** Override poll interval for testing. Defaults to 1000ms. */
  pollIntervalMs?: number;
  /** Override poll timeout for testing. Defaults to 30000ms. */
  pollTimeoutMs?: number;
}

/**
 * Core query logic, exported for unit testing without constructing the full
 * AI SDK tool wrapper. Pattern matches Phase 4's _executeSearch.
 *
 * The allowlist is a required argument rather than a module-level constant
 * lookup so that:
 *   1. Tests can pass their own allowlist directly (no production-code
 *      "test-only override" backdoor that future contributors might
 *      accidentally populate).
 *   2. The data flow is explicit: every call site declares which allowlist
 *      governs that call. The production binding lives in
 *      `cloudwatchLogsQueryTool` below; tests bind their own.
 */
export async function _executeQuery(
  deps: CloudWatchToolDeps,
  input: QueryInput,
  allowlist: readonly string[],
): Promise<QueryResult> {
  const { client, logger } = deps;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const { logGroupName, query, startTimeIso, endTimeIso } = input;

  // 1. Validate
  const validation = validateLogsInsightsQuery(query, logGroupName, allowlist);
  if (!validation.ok) {
    logger.warn({ logGroupName, reason: validation.reason }, 'cloudwatch query rejected');
    return { error: 'invalid_query', message: validation.reason };
  }

  const rewrittenQuery = validation.rewritten;

  // 2. Parse times. Surface a structured error rather than crashing on Date(NaN).
  const startEpochSec = Math.floor(new Date(startTimeIso).getTime() / 1000);
  const endEpochSec = Math.floor(new Date(endTimeIso).getTime() / 1000);
  if (!Number.isFinite(startEpochSec) || !Number.isFinite(endEpochSec)) {
    return {
      error: 'invalid_time',
      message: 'startTimeIso/endTimeIso must be valid ISO-8601',
    };
  }
  if (endEpochSec <= startEpochSec) {
    return { error: 'invalid_time', message: 'endTimeIso must be after startTimeIso' };
  }

  // 3. Start query
  const start = Date.now();
  let queryId: string | undefined;
  try {
    const startRes = await client.send(
      new StartQueryCommand({
        logGroupName,
        startTime: startEpochSec,
        endTime: endEpochSec,
        queryString: rewrittenQuery,
      }),
    );
    queryId = startRes.queryId;
  } catch (err: unknown) {
    return mapAwsError(err);
  }

  if (!queryId) {
    return { error: 'no_query_id', message: 'AWS did not return a queryId' };
  }

  // 4. Poll for results
  const deadline = Date.now() + pollTimeoutMs;
  let result: GetQueryResultsCommandOutput | undefined;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    try {
      result = await client.send(new GetQueryResultsCommand({ queryId }));
    } catch (err: unknown) {
      return mapAwsError(err);
    }
    if (
      result.status === 'Complete' ||
      result.status === 'Failed' ||
      result.status === 'Cancelled' ||
      result.status === 'Timeout'
    ) {
      break;
    }
  }

  if (!result) {
    return { error: 'timeout', message: `query did not complete within ${pollTimeoutMs}ms` };
  }
  if (result.status === 'Failed') {
    return { error: 'query_failed', message: 'AWS reported the query failed' };
  }
  if (result.status === 'Cancelled' || result.status === 'Timeout') {
    return { error: 'query_aborted', message: `AWS query status: ${result.status}` };
  }
  if (result.status !== 'Complete') {
    return {
      error: 'timeout',
      message: `query did not complete within ${pollTimeoutMs}ms (last status: ${result.status})`,
    };
  }

  // 5. Map results — array of arrays of {field,value} → array of records.
  const rows = (result.results ?? []).slice(0, MAX_ROWS_RETURNED).map(row => {
    const obj: Record<string, string | undefined> = {};
    for (const cell of row) {
      if (cell.field) obj[cell.field] = cell.value;
    }
    return obj;
  });

  const durationMs = Date.now() - start;
  logger.info(
    { logGroupName, rewrittenQuery, rowCount: rows.length, durationMs },
    'cloudwatch query complete',
  );

  return { rowCount: rows.length, rows, rewrittenQuery };
}

function mapAwsError(err: unknown): QueryResult {
  const e = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
    message?: string;
  };
  const name = e.name ?? 'UnknownError';
  const status = e.$metadata?.httpStatusCode;
  if (name === 'AccessDeniedException' || status === 403) {
    return { error: 'access_denied', message: `IAM denied: ${e.message ?? name}` };
  }
  if (name === 'ResourceNotFoundException' || status === 404) {
    return {
      error: 'log_group_not_found',
      message: 'log group does not exist in this region/account',
    };
  }
  if (name === 'ThrottlingException' || status === 429) {
    return {
      error: 'rate_limited',
      message: 'CloudWatch is throttling; try again in a minute',
    };
  }
  return { error: 'aws_error', message: `${name}: ${e.message ?? 'no message'}` };
}

export function cloudwatchLogsQueryTool(deps: CloudWatchToolDeps) {
  return tool({
    description:
      'Run a CloudWatch Logs Insights query against an allowlisted log group. ' +
      'The query MUST contain a `| stats` clause (e.g. `stats count() by bin(5m)`); ' +
      'raw row dumps and field extraction are not permitted. Results are capped at 100 rows. ' +
      `Allowed log groups: ${describeLogGroupAllowlist()}.`,
    inputSchema,
    // Production binding: the allowlist comes from the module-level constant.
    // Edit src/tools/cloudwatch/allowlist.ts to add log groups.
    execute: input => _executeQuery(deps, input, ALLOWED_LOG_GROUPS),
  });
}
