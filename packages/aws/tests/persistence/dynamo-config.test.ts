/**
 * DynamoDB config adapter tests.
 *
 * Tests verify adapter wiring: correct key construction, JSON serialization,
 * and query parameters.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock DynamoDB Toolbox ─────────────────────────────────────────────────────

const mockGetSend = vi.fn();
const mockPutSend = vi.fn();
const mockDeleteSend = vi.fn();
const mockQuerySend = vi.fn();

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

  class MockQueryCommand {
    private _query: unknown;
    entities(..._e: unknown[]) {
      return this;
    }
    query(q: unknown) {
      this._query = q;
      return this;
    }
    send() {
      return mockQuerySend(this._query);
    }
  }

  return {
    ...actual,
    GetItemCommand: MockGetItemCommand,
    PutItemCommand: MockPutItemCommand,
    DeleteItemCommand: MockDeleteItemCommand,
    QueryCommand: MockQueryCommand,
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
    padScheduledAt: (n: number) => String(n).padStart(13, "0"),
  };
});

const mockTableBuild = vi.fn();
const fakeTable = {
  build: mockTableBuild,
} as unknown as Parameters<typeof import("../../src/persistence/dynamo/config.js")["createDynamoConfigStore"]>[0];

const { createDynamoConfigStore } = await import("../../src/persistence/dynamo/config.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createDynamoConfigStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTableBuild.mockImplementation((CommandClass: new () => unknown) => {
      return new (CommandClass as new () => unknown)();
    });
  });

  it("get: uses pk=CONFIG, sk=CONFIG#<key>", async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoConfigStore(fakeTable);
    const result = await store.get("github.repos");

    expect(mockGetSend).toHaveBeenCalledWith({ pk: "CONFIG", sk: "CONFIG#github.repos" });
    expect(result).toBeNull();
  });

  it("get: returns raw JSON string from Item", async () => {
    mockGetSend.mockResolvedValue({ Item: { value: '["owner/repo"]' } });

    const store = createDynamoConfigStore(fakeTable);
    const result = await store.get("github.repos");

    expect(result).toBe('["owner/repo"]');
  });

  it("getTyped: parses JSON and returns typed value", async () => {
    mockGetSend.mockResolvedValue({ Item: { value: '["owner/repo"]' } });

    const store = createDynamoConfigStore(fakeTable);
    const result = await store.getTyped<string[]>("github.repos", []);

    expect(result).toEqual(["owner/repo"]);
  });

  it("getTyped: returns fallback when key is missing", async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoConfigStore(fakeTable);
    const result = await store.getTyped<string[]>("github.repos", ["default/repo"]);

    expect(result).toEqual(["default/repo"]);
  });

  it("set: uses pk=CONFIG, sk=CONFIG#<key> with JSON-stringified value", async () => {
    mockPutSend.mockResolvedValue({});

    const store = createDynamoConfigStore(fakeTable);
    await store.set("github.repos", ["owner/repo"]);

    const putArg = mockPutSend.mock.calls[0]?.[0] as {
      pk: string;
      sk: string;
      value: string;
      updatedAt: number;
    };

    expect(putArg.pk).toBe("CONFIG");
    expect(putArg.sk).toBe("CONFIG#github.repos");
    expect(putArg.value).toBe('["owner/repo"]');
    expect(typeof putArg.updatedAt).toBe("number");
  });

  it("list: queries pk=CONFIG with sk beginsWith CONFIG#", async () => {
    mockQuerySend.mockResolvedValue({ Items: [] });

    const store = createDynamoConfigStore(fakeTable);
    await store.list();

    const queryArg = mockQuerySend.mock.calls[0]?.[0] as {
      partition: string;
      range: { beginsWith: string };
    };

    expect(queryArg.partition).toBe("CONFIG");
    expect(queryArg.range.beginsWith).toBe("CONFIG#");
  });

  it("list: strips CONFIG# prefix from sk to get key", async () => {
    mockQuerySend.mockResolvedValue({
      Items: [
        { sk: "CONFIG#github.repos", value: '["owner/repo"]', updatedAt: 1000 },
        { sk: "CONFIG#cloudwatch.log_groups", value: "[]", updatedAt: 2000 },
      ],
    });

    const store = createDynamoConfigStore(fakeTable);
    const entries = await store.list();

    expect(entries).toHaveLength(2);
    // Sorted alphabetically
    expect(entries[0]).toEqual({ key: "cloudwatch.log_groups", value: "[]", updatedAt: 2000 });
    expect(entries[1]).toEqual({ key: "github.repos", value: '["owner/repo"]', updatedAt: 1000 });
  });

  it("delete: returns false when key does not exist", async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoConfigStore(fakeTable);
    const result = await store.delete("nonexistent.key");

    expect(result).toBe(false);
    expect(mockDeleteSend).not.toHaveBeenCalled();
  });

  it("delete: returns true and calls DeleteItem when key exists", async () => {
    mockGetSend.mockResolvedValue({ Item: { value: '["owner/repo"]' } });
    mockDeleteSend.mockResolvedValue({});

    const store = createDynamoConfigStore(fakeTable);
    const result = await store.delete("github.repos");

    expect(result).toBe(true);
    expect(mockDeleteSend).toHaveBeenCalledWith({ pk: "CONFIG", sk: "CONFIG#github.repos" });
  });
});
