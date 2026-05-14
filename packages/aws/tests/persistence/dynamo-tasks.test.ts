/**
 * DynamoDB tasks adapter tests.
 *
 * Tests verify adapter wiring: correct key construction, GSI key construction,
 * conditional update for cancel, and listPending query parameters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DynamoDB Toolbox ─────────────────────────────────────────────────────

const mockGetSend = vi.fn();
const mockPutSend = vi.fn();
const mockUpdateSend = vi.fn();
const mockQuerySend = vi.fn();
const mockScanSend = vi.fn();

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

  class MockUpdateItemCommand {
    private _item: unknown;
    private _opts: unknown;
    item(i: unknown) { this._item = i; return this; }
    options(o: unknown) { this._opts = o; return this; }
    send() { return mockUpdateSend(this._item, this._opts); }
  }

  class MockQueryCommand {
    private _query: unknown;
    private _opts: unknown;
    entities(..._e: unknown[]) { return this; }
    query(q: unknown) { this._query = q; return this; }
    options(o: unknown) { this._opts = o; return this; }
    send() { return mockQuerySend(this._query, this._opts); }
  }

  class MockScanCommand {
    private _opts: unknown;
    entities(..._e: unknown[]) { return this; }
    options(o: unknown) { this._opts = o; return this; }
    send() { return mockScanSend(this._opts); }
  }

  return {
    ...actual,
    GetItemCommand: MockGetItemCommand,
    PutItemCommand: MockPutItemCommand,
    UpdateItemCommand: MockUpdateItemCommand,
    QueryCommand: MockQueryCommand,
    ScanCommand: MockScanCommand,
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

// Mock table.build() for QueryCommand and ScanCommand
const mockTableBuild = vi.fn();
const fakeTable = {
  build: mockTableBuild,
} as unknown as Parameters<(typeof import('../../src/persistence/dynamo/tasks.js'))['createDynamoTaskStore']>[0];

const { createDynamoTaskStore } = await import('../../src/persistence/dynamo/tasks.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createDynamoTaskStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default table.build() returns a mock query/scan command
    mockTableBuild.mockImplementation((CommandClass: new () => unknown) => {
      const cmd = new (CommandClass as new () => unknown)();
      return cmd;
    });
  });

  it('create: uses pk=TASK#<id>, sk=TASK with correct GSI keys', async () => {
    mockPutSend.mockResolvedValue({});

    const store = createDynamoTaskStore(fakeTable);
    const scheduledAt = 1700000000;
    const task = await store.create('U1', 'test task', scheduledAt);

    const putArg = mockPutSend.mock.calls[0]?.[0] as {
      pk: string;
      sk: string;
      gsi1pk: string;
      gsi1sk: string;
      taskId: string;
      userId: string;
      status: string;
    };

    expect(putArg.pk).toBe(`TASK#${task.id}`);
    expect(putArg.sk).toBe('TASK');
    expect(putArg.gsi1pk).toBe('TASK_STATUS#pending');
    expect(putArg.gsi1sk).toBe('0001700000000'); // zero-padded 13 digits
    expect(putArg.taskId).toBe(task.id);
    expect(putArg.userId).toBe('U1');
    expect(putArg.status).toBe('pending');
    expect(task.status).toBe('pending');
    expect(task.result).toBeNull();
  });

  it('create: zero-pads scheduledAt to 13 digits', async () => {
    mockPutSend.mockResolvedValue({});

    const store = createDynamoTaskStore(fakeTable);
    await store.create('U1', 'task', 12345);

    const putArg = mockPutSend.mock.calls[0]?.[0] as { gsi1sk: string };
    expect(putArg.gsi1sk).toBe('0000000012345');
    expect(putArg.gsi1sk).toHaveLength(13);
  });

  it('getById: uses pk=TASK#<id>, sk=TASK', async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoTaskStore(fakeTable);
    const result = await store.getById('abc-123');

    expect(mockGetSend).toHaveBeenCalledWith({ pk: 'TASK#abc-123', sk: 'TASK' });
    expect(result).toBeNull();
  });

  it('getById: maps Item fields to Task shape', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockGetSend.mockResolvedValue({
      Item: {
        taskId: 'abc-123',
        userId: 'U1',
        description: 'do something',
        scheduledAt: now + 3600,
        status: 'pending',
        result: undefined,
        createdAt: now,
        updatedAt: now,
      },
    });

    const store = createDynamoTaskStore(fakeTable);
    const task = await store.getById('abc-123');

    expect(task).not.toBeNull();
    expect(task!.id).toBe('abc-123');
    expect(task!.userId).toBe('U1');
    expect(task!.status).toBe('pending');
    expect(task!.result).toBeNull();
  });

  it('listPending: queries GSI1 with gsi1pk=TASK_STATUS#pending and lte range', async () => {
    mockQuerySend.mockResolvedValue({ Items: [] });

    const store = createDynamoTaskStore(fakeTable);
    const now = 1700000000;
    await store.listPending(now);

    const queryArg = mockQuerySend.mock.calls[0]?.[0] as {
      index: string;
      partition: string;
      range: { lte: string };
    };

    expect(queryArg.index).toBe('gsi1');
    expect(queryArg.partition).toBe('TASK_STATUS#pending');
    expect(queryArg.range.lte).toBe('0001700000000');
  });

  it('updateStatus: updates status and gsi1pk to reflect new status', async () => {
    mockUpdateSend.mockResolvedValue({});

    const store = createDynamoTaskStore(fakeTable);
    await store.updateStatus('abc-123', 'running');

    const updateArg = mockUpdateSend.mock.calls[0]?.[0] as {
      pk: string;
      sk: string;
      status: string;
      gsi1pk: string;
    };

    expect(updateArg.pk).toBe('TASK#abc-123');
    expect(updateArg.sk).toBe('TASK');
    expect(updateArg.status).toBe('running');
    expect(updateArg.gsi1pk).toBe('TASK_STATUS#running');
  });

  it('updateStatus: includes result when provided', async () => {
    mockUpdateSend.mockResolvedValue({});

    const store = createDynamoTaskStore(fakeTable);
    await store.updateStatus('abc-123', 'completed', 'task output');

    const updateArg = mockUpdateSend.mock.calls[0]?.[0] as { result: string };
    expect(updateArg.result).toBe('task output');
  });

  it('cancel: uses conditional update with status=pending condition', async () => {
    mockUpdateSend.mockResolvedValue({});

    const store = createDynamoTaskStore(fakeTable);
    const result = await store.cancel('abc-123');

    expect(result).toBe(true);

    const updateArg = mockUpdateSend.mock.calls[0]?.[0] as {
      pk: string;
      status: string;
      gsi1pk: string;
    };
    const optsArg = mockUpdateSend.mock.calls[0]?.[1] as {
      condition: { attr: string; eq: string };
    };

    expect(updateArg.pk).toBe('TASK#abc-123');
    expect(updateArg.status).toBe('cancelled');
    expect(updateArg.gsi1pk).toBe('TASK_STATUS#cancelled');
    expect(optsArg.condition).toEqual({ attr: 'status', eq: 'pending' });
  });

  it('cancel: returns false when ConditionalCheckFailedException is thrown', async () => {
    const err = new Error('ConditionalCheckFailed');
    err.name = 'ConditionalCheckFailedException';
    mockUpdateSend.mockRejectedValue(err);

    const store = createDynamoTaskStore(fakeTable);
    const result = await store.cancel('abc-123');

    expect(result).toBe(false);
  });

  it('cancel: re-throws non-conditional errors', async () => {
    const err = new Error('Network error');
    mockUpdateSend.mockRejectedValue(err);

    const store = createDynamoTaskStore(fakeTable);
    await expect(store.cancel('abc-123')).rejects.toThrow('Network error');
  });
});
