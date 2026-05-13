import { describe, it, expect, vi } from 'vitest';
import { _executeListDms, _executeReadDm } from '../../src/tools/slack/dms.js';
import type { webApi } from '@slack/bolt';

// ---------------------------------------------------------------------------
// Mock WebClient factory
// ---------------------------------------------------------------------------

function makeClient(overrides: {
  conversationsList?: ReturnType<typeof vi.fn>;
  conversationsMembers?: ReturnType<typeof vi.fn>;
  conversationsHistory?: ReturnType<typeof vi.fn>;
  usersInfo?: ReturnType<typeof vi.fn>;
}): webApi.WebClient {
  return {
    conversations: {
      list: overrides.conversationsList ?? vi.fn(),
      members: overrides.conversationsMembers ?? vi.fn(),
      history: overrides.conversationsHistory ?? vi.fn(),
    },
    users: {
      info: overrides.usersInfo ?? vi.fn(),
    },
  } as unknown as webApi.WebClient;
}

// ---------------------------------------------------------------------------
// _executeListDms tests
// ---------------------------------------------------------------------------

describe('_executeListDms', () => {
  // 1. Happy path — 2 DMs (1 regular, 1 Connect)
  it('returns shaped conversations including isConnect flag', async () => {
    const usersInfo = vi.fn().mockImplementation(({ user }: { user: string }) => {
      const names: Record<string, string> = {
        U001: 'Alice',
        U002: 'Bob',
      };
      return Promise.resolve({
        ok: true,
        user: { profile: { display_name: names[user] ?? user, real_name: names[user] ?? user } },
      });
    });

    const conversationsList = vi.fn().mockResolvedValue({
      ok: true,
      channels: [
        {
          id: 'D001',
          is_im: true,
          is_mpim: false,
          user: 'U001',
          is_ext_shared: false,
          connected_team_ids: [],
        },
        {
          id: 'D002',
          is_im: true,
          is_mpim: false,
          user: 'U002',
          is_ext_shared: true, // Slack Connect DM
          connected_team_ids: ['T999'],
        },
      ],
    });

    const client = makeClient({ conversationsList, usersInfo });
    const result = await _executeListDms(client, { limit: 20 });

    expect(result).toMatchObject({
      count: 2,
      conversations: [
        { channelId: 'D001', userId: 'U001', userName: 'Alice', isGroup: false, isConnect: false },
        { channelId: 'D002', userId: 'U002', userName: 'Bob', isGroup: false, isConnect: true },
      ],
    });
  });

  // 2. Group DM — mpim conversation
  it('returns isGroup: true for mpim conversations', async () => {
    const usersInfo = vi.fn().mockImplementation(({ user }: { user: string }) =>
      Promise.resolve({
        ok: true,
        user: { profile: { display_name: user === 'U001' ? 'Alice' : 'Bob', real_name: '' } },
      }),
    );

    const conversationsList = vi.fn().mockResolvedValue({
      ok: true,
      channels: [
        {
          id: 'G001',
          is_im: false,
          is_mpim: true,
          is_ext_shared: false,
          connected_team_ids: [],
        },
      ],
    });

    const conversationsMembers = vi.fn().mockResolvedValue({
      ok: true,
      members: ['U001', 'U002'],
    });

    const client = makeClient({ conversationsList, conversationsMembers, usersInfo });
    const result = await _executeListDms(client, { limit: 20 });

    expect(result).toMatchObject({
      count: 1,
      conversations: [
        {
          channelId: 'G001',
          isGroup: true,
          isConnect: false,
          userName: 'Alice, Bob',
        },
      ],
    });
  });

  // 3. Auth error
  it('returns auth_error when Slack throws not_authed', async () => {
    const conversationsList = vi.fn().mockRejectedValue({ data: { error: 'not_authed' } });

    const client = makeClient({ conversationsList });
    const result = await _executeListDms(client, { limit: 20 });

    expect(result).toMatchObject({ error: 'auth_error' });
  });
});

// ---------------------------------------------------------------------------
// _executeReadDm tests
// ---------------------------------------------------------------------------

describe('_executeReadDm', () => {
  // 1. Happy path — 3 messages with user names resolved
  it('returns messages with resolved user names', async () => {
    const usersInfo = vi.fn().mockImplementation(({ user }: { user: string }) =>
      Promise.resolve({
        ok: true,
        user: {
          profile: {
            display_name: user === 'U001' ? 'Alice' : 'Bob',
            real_name: '',
          },
        },
      }),
    );

    const conversationsHistory = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: 'U001', text: 'hey there', ts: '1234567892.000300' },
        { user: 'U002', text: 'hi!', ts: '1234567891.000200' },
        { user: 'U001', text: 'how are you?', ts: '1234567890.000100' },
      ],
      has_more: false,
    });

    const client = makeClient({ conversationsHistory, usersInfo });
    const result = await _executeReadDm(client, { channel: 'D001', limit: 20 });

    expect(result).toMatchObject({
      count: 3,
      hasMore: false,
      messages: [
        { user: 'U001', userName: 'Alice', text: 'hey there', ts: '1234567892.000300' },
        { user: 'U002', userName: 'Bob', text: 'hi!', ts: '1234567891.000200' },
        { user: 'U001', userName: 'Alice', text: 'how are you?', ts: '1234567890.000100' },
      ],
    });
  });

  // 2. Empty conversation
  it('returns empty messages array for an empty conversation', async () => {
    const conversationsHistory = vi.fn().mockResolvedValue({
      ok: true,
      messages: [],
      has_more: false,
    });

    const client = makeClient({ conversationsHistory });
    const result = await _executeReadDm(client, { channel: 'D001', limit: 20 });

    expect(result).toEqual({ messages: [], count: 0, hasMore: false });
  });

  // 3. Channel not found
  it('returns channel_not_found when Slack throws channel_not_found', async () => {
    const conversationsHistory = vi
      .fn()
      .mockRejectedValue({ data: { error: 'channel_not_found' } });

    const client = makeClient({ conversationsHistory });
    const result = await _executeReadDm(client, { channel: 'DINVALID', limit: 20 });

    expect(result).toMatchObject({ error: 'channel_not_found' });
  });

  // 4. has_more flag is passed through
  it('passes has_more: true through to the result', async () => {
    const usersInfo = vi.fn().mockResolvedValue({
      ok: true,
      user: { profile: { display_name: 'Alice', real_name: '' } },
    });

    const conversationsHistory = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: 'U001', text: 'msg1', ts: '1234567892.000300' },
        { user: 'U001', text: 'msg2', ts: '1234567891.000200' },
      ],
      has_more: true,
    });

    const client = makeClient({ conversationsHistory, usersInfo });
    const result = await _executeReadDm(client, { channel: 'D001', limit: 2 });

    expect(result).toMatchObject({ count: 2, hasMore: true });
  });
});
