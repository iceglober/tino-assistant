/**
 * DynamoDB preferences adapter tests.
 *
 * Tests verify adapter wiring: correct key construction and query parameters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DynamoDB Toolbox ─────────────────────────────────────────────────────

const mockGetSend = vi.fn();
const mockPutSend = vi.fn();
const mockDeleteSend = vi.fn();
const mockQuerySend = vi.fn();

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

  class MockQueryCommand {
    private _query: unknown;
    entities(..._e: unknown[]) { return this; }
    query(q: unknown) { this._query = q; return this; }
    send() { return mockQuerySend(this._query); }
  }

  return {
    ...actual,
    GetItemCommand: MockGetItemCommand,
    PutItemCommand: MockPutItemCommand,
    DeleteItemCommand: MockDeleteItemCommand,
    QueryCommand: MockQueryCommand,
  };
});

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

const mockTableBuild = vi.fn();
const fakeTable = {
  build: mockTableBuild,
} as unknown as Parameters<(typeof import('../../src/persistence/dynamo/preferences.js'))['createDynamoPreferencesStore']>[0];

const { createDynamoPreferencesStore } = await import('../../src/persistence/dynamo/preferences.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createDynamoPreferencesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTableBuild.mockImplementation((CommandClass: new () => unknown) => {
      return new (CommandClass as new () => unknown)();
    });
  });

  it('get: uses pk=PREF#<userId>, sk=PREF#<key>', async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoPreferencesStore(fakeTable);
    const result = await store.get('U1', 'timezone');

    expect(mockGetSend).toHaveBeenCalledWith({ pk: 'PREF#U1', sk: 'PREF#timezone' });
    expect(result).toBeNull();
  });

  it('get: returns value from Item', async () => {
    mockGetSend.mockResolvedValue({ Item: { value: 'America/Chicago' } });

    const store = createDynamoPreferencesStore(fakeTable);
    const result = await store.get('U1', 'timezone');

    expect(result).toBe('America/Chicago');
  });

  it('set: uses pk=PREF#<userId>, sk=PREF#<key> with value', async () => {
    mockPutSend.mockResolvedValue({});

    const store = createDynamoPreferencesStore(fakeTable);
    await store.set('U1', 'timezone', 'UTC');

    const putArg = mockPutSend.mock.calls[0]?.[0] as {
      pk: string;
      sk: string;
      value: string;
      updatedAt: number;
    };

    expect(putArg.pk).toBe('PREF#U1');
    expect(putArg.sk).toBe('PREF#timezone');
    expect(putArg.value).toBe('UTC');
    expect(typeof putArg.updatedAt).toBe('number');
  });

  it('list: queries pk=PREF#<userId> with sk beginsWith PREF#', async () => {
    mockQuerySend.mockResolvedValue({ Items: [] });

    const store = createDynamoPreferencesStore(fakeTable);
    await store.list('U1');

    const queryArg = mockQuerySend.mock.calls[0]?.[0] as {
      partition: string;
      range: { beginsWith: string };
    };

    expect(queryArg.partition).toBe('PREF#U1');
    expect(queryArg.range.beginsWith).toBe('PREF#');
  });

  it('list: strips PREF# prefix from sk to get key', async () => {
    mockQuerySend.mockResolvedValue({
      Items: [
        { sk: 'PREF#timezone', value: 'UTC' },
        { sk: 'PREF#summary_style', value: 'bullet points' },
      ],
    });

    const store = createDynamoPreferencesStore(fakeTable);
    const prefs = await store.list('U1');

    expect(prefs).toHaveLength(2);
    // Sorted alphabetically
    expect(prefs[0]).toEqual({ key: 'summary_style', value: 'bullet points' });
    expect(prefs[1]).toEqual({ key: 'timezone', value: 'UTC' });
  });

  it('delete: uses pk=PREF#<userId>, sk=PREF#<key>', async () => {
    mockDeleteSend.mockResolvedValue({});

    const store = createDynamoPreferencesStore(fakeTable);
    await store.delete('U1', 'timezone');

    expect(mockDeleteSend).toHaveBeenCalledWith({ pk: 'PREF#U1', sk: 'PREF#timezone' });
  });
});
