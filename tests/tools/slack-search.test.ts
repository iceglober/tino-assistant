import { describe, it, expect, vi } from 'vitest';
import { _executeSlackSearch } from '../../src/tools/slack/search.js';
import type { webApi } from '@slack/bolt';

// ---------------------------------------------------------------------------
// Mock WebClient factory
// ---------------------------------------------------------------------------

function makeClient(searchMessagesMock: ReturnType<typeof vi.fn>): webApi.WebClient {
  return {
    search: {
      messages: searchMessagesMock,
    },
  } as unknown as webApi.WebClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_executeSlackSearch', () => {
  // 1. Happy path — returns shaped messages
  it('returns messages array and total on success', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: {
        matches: [
          {
            channel: { id: 'C001', name: 'engineering' },
            ts: '1234567890.000100',
            text: 'deployment went fine',
            user: 'U001',
            permalink: 'https://slack.com/archives/C001/p1234567890000100',
          },
          {
            channel: { id: 'C002', name: 'general' },
            ts: '1234567891.000200',
            text: 'another message',
            user: 'U002',
            permalink: 'https://slack.com/archives/C002/p1234567891000200',
          },
        ],
        total: 2,
      },
    });

    const client = makeClient(mock);
    const result = await _executeSlackSearch(client, { query: 'deployment', count: 10 });

    expect(result).toMatchObject({
      messages: [
        {
          channel: { id: 'C001', name: 'engineering' },
          ts: '1234567890.000100',
          text: 'deployment went fine',
          user: 'U001',
          permalink: 'https://slack.com/archives/C001/p1234567890000100',
        },
        {
          channel: { id: 'C002', name: 'general' },
          ts: '1234567891.000200',
          text: 'another message',
          user: 'U002',
          permalink: 'https://slack.com/archives/C002/p1234567891000200',
        },
      ],
      total: 2,
    });
  });

  // 2. No results — returns empty messages array
  it('returns empty messages array when no matches', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: { matches: [], total: 0 },
    });

    const client = makeClient(mock);
    const result = await _executeSlackSearch(client, { query: 'nonexistent', count: 10 });

    expect(result).toEqual({ messages: [], total: 0 });
  });

  // 3. Auth error (invalid_auth) — returns { error: 'auth_error' }
  it('returns auth_error when Slack throws invalid_auth', async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: 'invalid_auth' } });

    const client = makeClient(mock);
    const result = await _executeSlackSearch(client, { query: 'test', count: 10 });

    expect(result).toMatchObject({ error: 'auth_error' });
  });

  // 4. Missing scope — returns { error: 'missing_scope' }
  it('returns missing_scope when Slack throws missing_scope', async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: 'missing_scope' } });

    const client = makeClient(mock);
    const result = await _executeSlackSearch(client, { query: 'test', count: 10 });

    expect(result).toMatchObject({ error: 'missing_scope' });
  });

  // 5. count is passed through to the API call
  it('passes query, count, sort, and sort_dir to search.messages', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: { matches: [], total: 0 },
    });

    const client = makeClient(mock);
    await _executeSlackSearch(client, { query: 'auth bug', count: 5 });

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith({
      query: 'auth bug',
      count: 5,
      sort: 'timestamp',
      sort_dir: 'desc',
    });
  });
});
