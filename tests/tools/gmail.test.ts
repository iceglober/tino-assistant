import { describe, it, expect, vi } from 'vitest';
import { _executeGmailSearch } from '../../src/tools/google/gmail.js';
import type { gmail_v1 } from 'googleapis';

// ---------------------------------------------------------------------------
// Mock helper
// ---------------------------------------------------------------------------

const makeGmailClient = (overrides: {
  list?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
}) =>
  ({
    users: {
      messages: {
        list: overrides.list ?? vi.fn().mockResolvedValue({ data: { messages: [] } }),
        get: overrides.get ?? vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  }) as unknown as gmail_v1.Gmail;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseInput = { query: 'from:mom subject:trip', maxResults: 10 };

const makeListResponse = (ids: string[]) => ({
  data: { messages: ids.map(id => ({ id })) },
});

const makeGetResponse = (overrides: {
  id?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  snippet?: string;
  internalDate?: string;
}) => ({
  data: {
    threadId: overrides.threadId ?? 'thread-1',
    snippet: overrides.snippet ?? 'Hello from mom',
    internalDate: overrides.internalDate ?? '1715000000000',
    payload: {
      headers: [
        { name: 'Subject', value: overrides.subject ?? 'Trip planning' },
        { name: 'From', value: overrides.from ?? 'Mom <mom@example.com>' },
        { name: 'Date', value: 'Mon, 6 May 2026 10:00:00 -0500' },
      ],
    },
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_executeGmailSearch', () => {
  // 1. Happy path — messages found
  it('returns metadata for each message when results are found', async () => {
    const getMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeGetResponse({ id: 'msg-1', threadId: 'thread-1', subject: 'Trip planning', from: 'Mom <mom@example.com>', snippet: 'Hello from mom', internalDate: '1715000000000' }),
      )
      .mockResolvedValueOnce(
        makeGetResponse({ id: 'msg-2', threadId: 'thread-2', subject: 'Re: Trip planning', from: 'Mom <mom@example.com>', snippet: 'See you soon', internalDate: '1715100000000' }),
      );

    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue(makeListResponse(['msg-1', 'msg-2'])),
      get: getMock,
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect('messages' in result).toBe(true);
    if (!('messages' in result)) return;

    expect(result.count).toBe(2);

    const first = result.messages[0]!;
    expect(first.id).toBe('msg-1');
    expect(first.threadId).toBe('thread-1');
    expect(first.subject).toBe('Trip planning');
    expect(first.from).toBe('Mom <mom@example.com>');
    expect(first.snippet).toBe('Hello from mom');
    expect(first.internalDate).toBe('1715000000000');

    const second = result.messages[1]!;
    expect(second.id).toBe('msg-2');
    expect(second.threadId).toBe('thread-2');
    expect(second.subject).toBe('Re: Trip planning');
    expect(second.snippet).toBe('See you soon');
  });

  // 2. No results — empty messages array
  it('returns { messages: [], count: 0 } when list returns no messages', async () => {
    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect('messages' in result).toBe(true);
    if (!('messages' in result)) return;

    expect(result.messages).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('returns { messages: [], count: 0 } when list returns undefined messages', async () => {
    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue({ data: {} }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect('messages' in result).toBe(true);
    if (!('messages' in result)) return;

    expect(result.messages).toEqual([]);
    expect(result.count).toBe(0);
  });

  // 3. Missing headers — defaults to empty string
  it('defaults subject to empty string when Subject header is absent', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: {
        threadId: 'thread-1',
        snippet: 'No subject here',
        internalDate: '1715000000000',
        payload: {
          headers: [
            // No Subject header — only From
            { name: 'From', value: 'someone@example.com' },
          ],
        },
      },
    });

    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue(makeListResponse(['msg-1'])),
      get: getMock,
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect('messages' in result).toBe(true);
    if (!('messages' in result)) return;

    expect(result.messages[0]!.subject).toBe('');
    expect(result.messages[0]!.from).toBe('someone@example.com');
  });

  // 4. Auth error (401)
  it('returns { error: "auth_error" } on 401', async () => {
    const client = makeGmailClient({
      list: vi.fn().mockRejectedValue({ code: 401, message: 'invalid_grant' }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;

    expect(result.error).toBe('auth_error');
    expect(result.message).toContain('401');
    expect(result.message).toContain('invalid_grant');
  });

  // 5. Auth error (403)
  it('returns { error: "auth_error" } on 403', async () => {
    const client = makeGmailClient({
      list: vi.fn().mockRejectedValue({ code: 403 }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;

    expect(result.error).toBe('auth_error');
    expect(result.message).toContain('403');
  });

  // 6. maxResults passed through to messages.list
  it('passes maxResults through to the Gmail API list call', async () => {
    const listMock = vi.fn().mockResolvedValue({ data: { messages: [] } });
    const client = makeGmailClient({ list: listMock });

    await _executeGmailSearch(client, { ...baseInput, maxResults: 5 });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 5 }),
    );
  });
});
