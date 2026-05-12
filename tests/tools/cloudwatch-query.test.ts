/**
 * Unit tests for _executeQuery — the CloudWatch Logs Insights query wrapper.
 *
 * These tests exercise the validator → AWS client path without making real
 * AWS calls. The AWS SDK client is mocked with vi.fn().
 *
 * Pattern matches tests/tools/github.test.ts (Phase 4).
 *
 * Note: _executeQuery accepts `_allowlistOverride` in deps for testing.
 * This lets us exercise the AWS-call path without populating the production
 * allowlist (which ships empty / fail-closed).
 */

import { describe, expect, test, vi } from 'vitest';
import { _executeQuery } from '../../src/tools/cloudwatch/query.js';
import type { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import type { AppLogger } from '../../src/slack/app.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const makeLogger = (): AppLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const makeClient = (sendImpl: ReturnType<typeof vi.fn>): CloudWatchLogsClient =>
  ({ send: sendImpl } as unknown as CloudWatchLogsClient);

const TEST_ALLOWLIST = ['/aws/lambda/test-fn'] as const;
const TEST_GROUP = '/aws/lambda/test-fn';

const VALID_INPUT = {
  logGroupName: TEST_GROUP,
  query: 'fields @timestamp | stats count() by bin(1m)',
  startTimeIso: '2026-05-12T10:00:00Z',
  endTimeIso: '2026-05-12T11:00:00Z',
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_executeQuery', () => {
  test('1. validator rejects (empty allowlist) → no AWS call, returns { error: "invalid_query" }', async () => {
    const sendFn = vi.fn();
    const client = makeClient(sendFn);
    const logger = makeLogger();

    const result = await _executeQuery(
      {
        client,
        logger,
        pollIntervalMs: 10,
        pollTimeoutMs: 100,
        _allowlistOverride: [], // empty — every group rejected
      },
      VALID_INPUT,
    );

    expect(sendFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: 'invalid_query' });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  test('2. happy path — StartQuery + Complete → returns rowCount, rows, rewrittenQuery', async () => {
    const sendFn = vi
      .fn()
      // First call: StartQueryCommand → returns queryId
      .mockResolvedValueOnce({ queryId: 'test-query-id-123' })
      // Second call: GetQueryResultsCommand → Complete with results
      .mockResolvedValueOnce({
        status: 'Complete',
        results: [
          [
            { field: 'count', value: '42' },
            { field: 'bin', value: '2026-05-12T10:00:00.000Z' },
          ],
          [
            { field: 'count', value: '7' },
            { field: 'bin', value: '2026-05-12T10:01:00.000Z' },
          ],
        ],
      });

    const client = makeClient(sendFn);
    const logger = makeLogger();

    const result = await _executeQuery(
      {
        client,
        logger,
        pollIntervalMs: 10,
        pollTimeoutMs: 5000,
        _allowlistOverride: TEST_ALLOWLIST,
      },
      VALID_INPUT,
    );

    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      rowCount: 2,
      rows: [
        { count: '42', bin: '2026-05-12T10:00:00.000Z' },
        { count: '7', bin: '2026-05-12T10:01:00.000Z' },
      ],
    });
    // Limit was auto-injected since the query had no | limit
    if ('rewrittenQuery' in result) {
      expect(result.rewrittenQuery).toMatch(/\|\s*limit\s+1000/i);
    }
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ logGroupName: TEST_GROUP, rowCount: 2 }),
      'cloudwatch query complete',
    );
  });

  test('3. AWS reports status Failed → returns { error: "query_failed" }', async () => {
    const sendFn = vi
      .fn()
      .mockResolvedValueOnce({ queryId: 'q-id' })
      .mockResolvedValueOnce({ status: 'Failed' });

    const client = makeClient(sendFn);
    const logger = makeLogger();

    const result = await _executeQuery(
      {
        client,
        logger,
        pollIntervalMs: 10,
        pollTimeoutMs: 5000,
        _allowlistOverride: TEST_ALLOWLIST,
      },
      VALID_INPUT,
    );

    expect(result).toMatchObject({ error: 'query_failed' });
  });

  test('4. StartQuery throws AccessDeniedException → returns { error: "access_denied" }', async () => {
    const accessDeniedErr = Object.assign(new Error('User is not authorized to perform logs:StartQuery'), {
      name: 'AccessDeniedException',
      $metadata: { httpStatusCode: 403 },
    });
    const sendFn = vi.fn().mockRejectedValueOnce(accessDeniedErr);

    const client = makeClient(sendFn);
    const logger = makeLogger();

    const result = await _executeQuery(
      {
        client,
        logger,
        pollIntervalMs: 10,
        pollTimeoutMs: 5000,
        _allowlistOverride: TEST_ALLOWLIST,
      },
      VALID_INPUT,
    );

    expect(result).toMatchObject({ error: 'access_denied' });
    if ('message' in result) {
      expect(result.message).toMatch(/IAM denied/i);
    }
  });

  test('5. query never completes within poll budget → returns { error: "timeout" }', async () => {
    const sendFn = vi
      .fn()
      .mockResolvedValueOnce({ queryId: 'q-id' }) // StartQuery
      .mockResolvedValue({ status: 'Running' }); // GetQueryResults always Running

    const client = makeClient(sendFn);
    const logger = makeLogger();

    const result = await _executeQuery(
      {
        client,
        logger,
        pollIntervalMs: 10,
        pollTimeoutMs: 50, // very short — will time out after ~1 poll
        _allowlistOverride: TEST_ALLOWLIST,
      },
      VALID_INPUT,
    );

    expect(result).toMatchObject({ error: 'timeout' });
  });
});
