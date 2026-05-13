import { describe, it, expect, vi } from 'vitest';
import { _executeSlackReadThread } from '../../src/tools/slack/thread.js';
import type { webApi } from '@slack/bolt';

// ---------------------------------------------------------------------------
// Mock WebClient factory
// ---------------------------------------------------------------------------

function makeClient(repliesMock: ReturnType<typeof vi.fn>): webApi.WebClient {
  return {
    conversations: {
      replies: repliesMock,
    },
  } as unknown as webApi.WebClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_executeSlackReadThread', () => {
  // 1. Happy path — returns shaped messages
  it('returns messages, count, and hasMore on success', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: 'U001', text: 'parent message', ts: '1234567890.000100' },
        { user: 'U002', text: 'first reply', ts: '1234567891.000200' },
        { user: 'U001', text: 'second reply', ts: '1234567892.000300' },
      ],
      has_more: false,
    });

    const client = makeClient(mock);
    const result = await _executeSlackReadThread(client, {
      channel: 'C001',
      threadTs: '1234567890.000100',
      limit: 20,
    });

    expect(result).toMatchObject({
      messages: [
        { user: 'U001', text: 'parent message', ts: '1234567890.000100' },
        { user: 'U002', text: 'first reply', ts: '1234567891.000200' },
        { user: 'U001', text: 'second reply', ts: '1234567892.000300' },
      ],
      count: 3,
      hasMore: false,
    });
  });

  // 2. Thread not found — returns { error: 'thread_not_found' }
  it('returns thread_not_found when Slack throws thread_not_found', async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: 'thread_not_found' } });

    const client = makeClient(mock);
    const result = await _executeSlackReadThread(client, {
      channel: 'C001',
      threadTs: '9999999999.000000',
      limit: 20,
    });

    expect(result).toMatchObject({ error: 'thread_not_found' });
  });

  // 3. Channel not found — returns { error: 'channel_not_found' }
  it('returns channel_not_found when Slack throws channel_not_found', async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: 'channel_not_found' } });

    const client = makeClient(mock);
    const result = await _executeSlackReadThread(client, {
      channel: 'CINVALID',
      threadTs: '1234567890.000100',
      limit: 20,
    });

    expect(result).toMatchObject({ error: 'channel_not_found' });
  });

  // 4. Auth error — returns { error: 'auth_error' }
  it('returns auth_error when Slack throws not_authed', async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: 'not_authed' } });

    const client = makeClient(mock);
    const result = await _executeSlackReadThread(client, {
      channel: 'C001',
      threadTs: '1234567890.000100',
      limit: 20,
    });

    expect(result).toMatchObject({ error: 'auth_error' });
  });

  // 5. has_more flag is propagated
  it('returns hasMore: true when API returns has_more: true', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: 'U001', text: 'parent', ts: '1234567890.000100' },
        { user: 'U002', text: 'reply 1', ts: '1234567891.000200' },
      ],
      has_more: true,
    });

    const client = makeClient(mock);
    const result = await _executeSlackReadThread(client, {
      channel: 'C001',
      threadTs: '1234567890.000100',
      limit: 2,
    });

    expect(result).toMatchObject({ hasMore: true, count: 2 });
  });
});
