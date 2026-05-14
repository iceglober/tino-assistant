import { describe, it, expect, vi } from 'vitest';
import { _executeListDms, _executeReadDm } from '../../src/tools/slack/dms.js';
import type { webApi } from '@slack/bolt';
import type { UserCache } from '../../src/slack/userCache.js';

// ---------------------------------------------------------------------------
// Mock WebClient factory
// ---------------------------------------------------------------------------

function makeClient(overrides: {
  conversationsList?: ReturnType<typeof vi.fn>;
  conversationsMembers?: ReturnType<typeof vi.fn>;
  conversationsHistory?: ReturnType<typeof vi.fn>;
}): webApi.WebClient {
  return {
    conversations: {
      list: overrides.conversationsList ?? vi.fn(),
      members: overrides.conversationsMembers ?? vi.fn(),
      history: overrides.conversationsHistory ?? vi.fn(),
    },
  } as unknown as webApi.WebClient;
}

// ---------------------------------------------------------------------------
// Mock UserCache factory
// ---------------------------------------------------------------------------

function makeUserCache(nameMap: Record<string, string>): UserCache {
  return {
    get: (userId: string) => {
      const name = nameMap[userId];
      if (!name) return undefined;
      return { id: userId, name, isBot: false, isExternal: false, teamId: 'T001' };
    },
    resolve: async (userId: string) => ({
      id: userId,
      name: nameMap[userId] ?? userId,
      isBot: false,
      isExternal: false,
      teamId: 'T001',
    }),
    getAll: () => Object.entries(nameMap).map(([id, name]) => ({ id, name, isBot: false, isExternal: false, teamId: 'T001' })),
    size: () => Object.keys(nameMap).length,
  };
}

// ---------------------------------------------------------------------------
// _executeListDms tests
// ---------------------------------------------------------------------------

describe('_executeListDms', () => {
  // 1. Happy path — 2 DMs (1 regular, 1 Connect)
  it('returns shaped conversations including isConnect flag', async () => {
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

    const client = makeClient({ conversationsList });
    const userCache = makeUserCache({ U001: 'Alice', U002: 'Bob' });
    const result = await _executeListDms(client, { limit: 20 }, userCache);

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

    const client = makeClient({ conversationsList, conversationsMembers });
    const userCache = makeUserCache({ U001: 'Alice', U002: 'Bob' });
    const result = await _executeListDms(client, { limit: 20 }, userCache);

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
    const userCache = makeUserCache({});
    const result = await _executeListDms(client, { limit: 20 }, userCache);

    expect(result).toMatchObject({ error: 'auth_error' });
  });

  // 4. sinceIso — filters conversations by checking conversations.history for real messages
  it('returns only conversations with real messages after sinceIso', async () => {
    const sinceIso = '2026-05-12T00:00:00.000Z';

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
          is_ext_shared: false,
          connected_team_ids: [],
        },
      ],
      response_metadata: { next_cursor: '' },
    });

    // D001 has a message after sinceIso, D002 does not
    const conversationsHistory = vi.fn().mockImplementation(({ channel }: { channel: string }) => {
      if (channel === 'D001') {
        return Promise.resolve({ ok: true, messages: [{ text: 'hello', ts: '1747008100.000000' }] });
      }
      return Promise.resolve({ ok: true, messages: [] });
    });

    const client = makeClient({ conversationsList, conversationsHistory });
    const userCache = makeUserCache({ U001: 'Alice', U002: 'Bob' });
    const result = await _executeListDms(client, { limit: 20, sinceIso }, userCache);

    expect(result).toMatchObject({
      count: 1,
      conversations: [
        { channelId: 'D001', userName: 'Alice' },
      ],
    });
    if ('conversations' in result) {
      expect(result.conversations.find(c => c.channelId === 'D002')).toBeUndefined();
    }
  });

  // 5. sinceIso — paginates through multiple pages
  it('paginates through all pages when sinceIso is provided', async () => {
    const sinceIso = '2026-05-12T00:00:00.000Z';

    const conversationsList = vi
      .fn()
      .mockResolvedValueOnce({
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
        ],
        response_metadata: { next_cursor: 'cursor1' },
      })
      .mockResolvedValueOnce({
        ok: true,
        channels: [
          {
            id: 'D002',
            is_im: true,
            is_mpim: false,
            user: 'U002',
            is_ext_shared: false,
            connected_team_ids: [],
          },
        ],
        response_metadata: { next_cursor: '' },
      });

    // D001 has no messages after sinceIso, D002 does
    const conversationsHistory = vi.fn().mockImplementation(({ channel }: { channel: string }) => {
      if (channel === 'D002') {
        return Promise.resolve({ ok: true, messages: [{ text: 'hi', ts: '1747008200.000000' }] });
      }
      return Promise.resolve({ ok: true, messages: [] });
    });

    const client = makeClient({ conversationsList, conversationsHistory });
    const userCache = makeUserCache({ U001: 'Alice', U002: 'Bob' });
    const result = await _executeListDms(client, { limit: 20, sinceIso }, userCache);

    expect(conversationsList).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      count: 1,
      conversations: [{ channelId: 'D002', userName: 'Bob' }],
    });
  });
});

// ---------------------------------------------------------------------------
// _executeReadDm tests
// ---------------------------------------------------------------------------

describe('_executeReadDm', () => {
  // 1. Happy path — 3 messages with user names resolved
  it('returns messages with resolved user names', async () => {
    const conversationsHistory = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: 'U001', text: 'hey there', ts: '1234567892.000300' },
        { user: 'U002', text: 'hi!', ts: '1234567891.000200' },
        { user: 'U001', text: 'how are you?', ts: '1234567890.000100' },
      ],
      has_more: false,
    });

    const client = makeClient({ conversationsHistory });
    const userCache = makeUserCache({ U001: 'Alice', U002: 'Bob' });
    const result = await _executeReadDm(client, { channel: 'D001', limit: 20 }, userCache);

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
    const userCache = makeUserCache({});
    const result = await _executeReadDm(client, { channel: 'D001', limit: 20 }, userCache);

    expect(result).toEqual({ messages: [], count: 0, hasMore: false });
  });

  // 3. Channel not found
  it('returns channel_not_found when Slack throws channel_not_found', async () => {
    const conversationsHistory = vi
      .fn()
      .mockRejectedValue({ data: { error: 'channel_not_found' } });

    const client = makeClient({ conversationsHistory });
    const userCache = makeUserCache({});
    const result = await _executeReadDm(client, { channel: 'DINVALID', limit: 20 }, userCache);

    expect(result).toMatchObject({ error: 'channel_not_found' });
  });

  // 4. has_more flag is passed through
  it('passes has_more: true through to the result', async () => {
    const conversationsHistory = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: 'U001', text: 'msg1', ts: '1234567892.000300' },
        { user: 'U001', text: 'msg2', ts: '1234567891.000200' },
      ],
      has_more: true,
    });

    const client = makeClient({ conversationsHistory });
    const userCache = makeUserCache({ U001: 'Alice' });
    const result = await _executeReadDm(client, { channel: 'D001', limit: 2 }, userCache);

    expect(result).toMatchObject({ count: 2, hasMore: true });
  });
});
