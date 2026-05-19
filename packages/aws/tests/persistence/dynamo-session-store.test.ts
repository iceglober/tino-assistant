import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSend = vi.fn();
const mockPutSend = vi.fn();
const mockDeleteSend = vi.fn();

vi.mock("dynamodb-toolbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dynamodb-toolbox")>();

  class MockGetItemCommand {
    private _key: unknown;
    key(k: unknown) {
      this._key = k;
      return this;
    }
    send() {
      return mockGetSend(this._key);
    }
  }

  class MockPutItemCommand {
    private _item: unknown;
    item(i: unknown) {
      this._item = i;
      return this;
    }
    send() {
      return mockPutSend(this._item);
    }
  }

  class MockDeleteItemCommand {
    private _key: unknown;
    key(k: unknown) {
      this._key = k;
      return this;
    }
    send() {
      return mockDeleteSend(this._key);
    }
  }

  return {
    ...actual,
    GetItemCommand: MockGetItemCommand,
    PutItemCommand: MockPutItemCommand,
    DeleteItemCommand: MockDeleteItemCommand,
  };
});

vi.mock("../../src/persistence/dynamo/entities.js", () => {
  const mockEntity = {
    build: (CommandClass: new () => unknown) => new (CommandClass as new () => unknown)(),
  };
  return {
    createHistoryEntity: () => mockEntity,
    createTaskEntity: () => mockEntity,
    createPreferenceEntity: () => mockEntity,
    createConfigEntity: () => mockEntity,
    createSessionEntity: () => mockEntity,
    padScheduledAt: (n: number) => String(n).padStart(13, "0"),
  };
});

const fakeTable = {} as Parameters<
  typeof import("../../src/persistence/dynamo/session-store.js")["createDynamoSessionStore"]
>[0];

const { createDynamoSessionStore } = await import("../../src/persistence/dynamo/session-store.js");

describe("createDynamoSessionStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("set then get round-trips a session value", async () => {
    mockPutSend.mockResolvedValue({});
    mockGetSend.mockResolvedValue({ Item: { value: '{"token":"abc"}', expiresAt: undefined } });

    const store = createDynamoSessionStore(fakeTable);
    await store.set("sess-123", '{"token":"abc"}');
    const result = await store.get("sess-123");

    expect(mockPutSend).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: "SESSION#sess-123",
        sk: "SESSION#sess-123",
        value: '{"token":"abc"}',
      }),
    );
    expect(mockGetSend).toHaveBeenCalledWith({ pk: "SESSION#sess-123", sk: "SESSION#sess-123" });
    expect(result).toBe('{"token":"abc"}');
  });

  it("set with TTL sets the dynamo expiresAt field", async () => {
    mockPutSend.mockResolvedValue({});

    const store = createDynamoSessionStore(fakeTable);
    const before = Math.floor(Date.now() / 1000);
    await store.set("sess-456", "value", 3600);

    const putArg = mockPutSend.mock.calls[0]?.[0] as {
      pk: string;
      sk: string;
      value: string;
      expiresAt: number;
      updatedAt: number;
    };

    expect(putArg.pk).toBe("SESSION#sess-456");
    expect(putArg.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(putArg.expiresAt).toBeLessThanOrEqual(before + 3602);
  });

  it("get after delete returns null", async () => {
    mockDeleteSend.mockResolvedValue({});
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoSessionStore(fakeTable);
    await store.delete("sess-789");
    const result = await store.get("sess-789");

    expect(mockDeleteSend).toHaveBeenCalledWith({ pk: "SESSION#sess-789", sk: "SESSION#sess-789" });
    expect(result).toBeNull();
  });

  it("get returns null for nonexistent key", async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoSessionStore(fakeTable);
    const result = await store.get("nonexistent");

    expect(result).toBeNull();
  });

  it("get returns null for expired item", async () => {
    mockGetSend.mockResolvedValue({
      Item: { value: "stale", expiresAt: Math.floor(Date.now() / 1000) - 100 },
    });

    const store = createDynamoSessionStore(fakeTable);
    const result = await store.get("expired-sess");

    expect(result).toBeNull();
  });
});
