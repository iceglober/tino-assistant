/**
 * DynamoDB history adapter tests.
 *
 * Tests verify adapter wiring: correct key construction, JSON serialization,
 * and that the right DynamoDB Toolbox commands are invoked.
 *
 * We mock the DynamoDB Toolbox entity methods rather than hitting a real
 * DynamoDB endpoint. The SQLite tests already cover business logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelMessage } from 'ai';

// ── Mock DynamoDB Toolbox ─────────────────────────────────────────────────────

// We mock the entire dynamodb-toolbox module so no AWS calls are made.
// Each command's send() is replaced with a vi.fn() we can inspect.

const mockGetSend = vi.fn();
const mockPutSend = vi.fn();
const mockDeleteSend = vi.fn();

vi.mock('dynamodb-toolbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dynamodb-toolbox')>();

  class MockGetItemCommand {
    private _key: unknown;
    key(k: unknown) { this._key = k; return this; }
    send() { return mockGetSend(this._key); }
  }

  class MockPutItemCommand {
    private _item: unknown;
    item(i: unknown) { this._item = i; return this; }
    send() { return mockPutSend(this._item); }
  }

  class MockDeleteItemCommand {
    private _key: unknown;
    key(k: unknown) { this._key = k; return this; }
    send() { return mockDeleteSend(this._key); }
  }

  return {
    ...actual,
    GetItemCommand: MockGetItemCommand,
    PutItemCommand: MockPutItemCommand,
    DeleteItemCommand: MockDeleteItemCommand,
  };
});

// ── Mock entity.build() ───────────────────────────────────────────────────────

vi.mock('../../src/persistence/dynamo/entities.js', () => {
  const mockEntity = {
    build: (CommandClass: new () => unknown) => new (CommandClass as new () => unknown)(),
  };
  return {
    createHistoryEntity: () => mockEntity,
    createTaskEntity: () => mockEntity,
    createPreferenceEntity: () => mockEntity,
    createConfigEntity: () => mockEntity,
    padScheduledAt: (n: number) => String(n).padStart(13, '0'),
  };
});

// ── Import after mocks ────────────────────────────────────────────────────────

const { createDynamoHistoryStore } = await import('../../src/persistence/dynamo/history.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

const fakeTable = {} as Parameters<typeof createDynamoHistoryStore>[0];

describe('createDynamoHistoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get: uses pk=HISTORY#<userId>, sk=HISTORY', async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoHistoryStore(fakeTable);
    const result = await store.get('U1');

    expect(mockGetSend).toHaveBeenCalledWith({ pk: 'HISTORY#U1', sk: 'HISTORY' });
    expect(result).toEqual([]);
  });

  it('get: deserializes messagesJson from Item', async () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    mockGetSend.mockResolvedValue({
      Item: { messagesJson: JSON.stringify(msgs) },
    });

    const store = createDynamoHistoryStore(fakeTable);
    const result = await store.get('U1');

    expect(result).toEqual(msgs);
  });

  it('get: returns empty array when Item is undefined', async () => {
    mockGetSend.mockResolvedValue({});

    const store = createDynamoHistoryStore(fakeTable);
    const result = await store.get('U1');

    expect(result).toEqual([]);
  });

  it('append: reads existing messages then writes combined+trimmed', async () => {
    const existing: ModelMessage[] = [{ role: 'user', content: 'existing' }];
    const newMsgs: ModelMessage[] = [{ role: 'assistant', content: 'new' }];

    mockGetSend.mockResolvedValue({
      Item: { messagesJson: JSON.stringify(existing) },
    });
    mockPutSend.mockResolvedValue({});

    const store = createDynamoHistoryStore(fakeTable);
    await store.append('U1', newMsgs);

    // Verify put was called with combined messages
    const putArg = mockPutSend.mock.calls[0]?.[0] as {
      pk: string;
      sk: string;
      messagesJson: string;
      updatedAt: number;
    };
    expect(putArg.pk).toBe('HISTORY#U1');
    expect(putArg.sk).toBe('HISTORY');
    const written = JSON.parse(putArg.messagesJson) as ModelMessage[];
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ role: 'user', content: 'existing' });
    expect(written[1]).toMatchObject({ role: 'assistant', content: 'new' });
    expect(typeof putArg.updatedAt).toBe('number');
  });

  it('append: trims to cap when messages exceed cap', async () => {
    // Create 45 messages (cap is 40)
    const existing: ModelMessage[] = Array.from({ length: 45 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    } as ModelMessage));

    mockGetSend.mockResolvedValue({
      Item: { messagesJson: JSON.stringify(existing) },
    });
    mockPutSend.mockResolvedValue({});

    const store = createDynamoHistoryStore(fakeTable, 40);
    await store.append('U1', []);

    const putArg = mockPutSend.mock.calls[0]?.[0] as { messagesJson: string };
    const written = JSON.parse(putArg.messagesJson) as ModelMessage[];
    expect(written.length).toBeLessThanOrEqual(40);
  });

  it('reset: uses pk=HISTORY#<userId>, sk=HISTORY for delete', async () => {
    mockDeleteSend.mockResolvedValue({});

    const store = createDynamoHistoryStore(fakeTable);
    await store.reset('U1');

    expect(mockDeleteSend).toHaveBeenCalledWith({ pk: 'HISTORY#U1', sk: 'HISTORY' });
  });
});
