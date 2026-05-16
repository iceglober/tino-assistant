/**
 * DynamoDB audit logger tests.
 *
 * Tests verify adapter wiring: correct key construction, TTL calculation,
 * GSI1 usage for userId queries, and entry serialization.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock DynamoDB Toolbox ─────────────────────────────────────────────────────

const mockPutSend = vi.fn();
const mockQuerySend = vi.fn();
const mockScanSend = vi.fn();

vi.mock("dynamodb-toolbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dynamodb-toolbox")>();

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

  class MockScanCommand {
    private _opts: unknown;
    entities(..._e: unknown[]) {
      return this;
    }
    options(o: unknown) {
      this._opts = o;
      return this;
    }
    send() {
      return mockScanSend(this._opts);
    }
  }

  return {
    ...actual,
    PutItemCommand: MockPutItemCommand,
    QueryCommand: MockQueryCommand,
    ScanCommand: MockScanCommand,
  };
});

const mockTableBuild = vi.fn();
const fakeTable = {
  build: mockTableBuild,
} as unknown as Parameters<typeof import("../../src/audit/dynamo.js")["createDynamoAuditLogger"]>[0];

const { createDynamoAuditLogger } = await import("../../src/audit/dynamo.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createDynamoAuditLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTableBuild.mockImplementation((CommandClass: new () => unknown) => {
      return new (CommandClass as new () => unknown)();
    });
  });

  describe("log", () => {
    it("writes item with correct pk pattern AUDIT#<timestamp>#<userId>", async () => {
      mockPutSend.mockResolvedValue({});

      const logger = createDynamoAuditLogger(fakeTable);
      await logger.log({
        userId: "U123",
        action: "tool_call",
        toolName: "github_search",
        inputKeys: ["query", "repo"],
        durationMs: 250,
        status: "success",
      });

      const putArg = mockPutSend.mock.calls[0]?.[0] as {
        pk: string;
        sk: string;
        gsi1pk: string;
        gsi1sk: string;
        userId: string;
        action: string;
        toolName: string;
        inputKeys: string;
        durationMs: number;
        status: string;
        ttl: number;
      };

      expect(putArg.pk).toMatch(/^AUDIT#\d{16}#U123$/);
      expect(putArg.sk).toBe("AUDIT");
      expect(putArg.gsi1pk).toBe("AUDIT_USER#U123");
      expect(putArg.gsi1sk).toMatch(/^\d{16}$/);
      expect(putArg.userId).toBe("U123");
      expect(putArg.action).toBe("tool_call");
      expect(putArg.toolName).toBe("github_search");
      expect(putArg.inputKeys).toBe('["query","repo"]');
      expect(putArg.durationMs).toBe(250);
      expect(putArg.status).toBe("success");
    });

    it("sets TTL to approximately 90 days from now by default", async () => {
      mockPutSend.mockResolvedValue({});

      const before = Math.floor(Date.now() / 1000);
      const logger = createDynamoAuditLogger(fakeTable);
      await logger.log({ userId: "U1", action: "login", status: "success" });
      const after = Math.floor(Date.now() / 1000);

      const putArg = mockPutSend.mock.calls[0]?.[0] as { ttl: number };
      const expectedTtlMin = before + 90 * 24 * 60 * 60;
      const expectedTtlMax = after + 90 * 24 * 60 * 60;

      expect(putArg.ttl).toBeGreaterThanOrEqual(expectedTtlMin);
      expect(putArg.ttl).toBeLessThanOrEqual(expectedTtlMax);
    });

    it("respects custom retention seconds", async () => {
      mockPutSend.mockResolvedValue({});

      const THIRTY_DAYS = 30 * 24 * 60 * 60;
      const before = Math.floor(Date.now() / 1000);
      const logger = createDynamoAuditLogger(fakeTable, THIRTY_DAYS);
      await logger.log({ userId: "U1", action: "config_change", status: "success" });
      const after = Math.floor(Date.now() / 1000);

      const putArg = mockPutSend.mock.calls[0]?.[0] as { ttl: number };
      expect(putArg.ttl).toBeGreaterThanOrEqual(before + THIRTY_DAYS);
      expect(putArg.ttl).toBeLessThanOrEqual(after + THIRTY_DAYS);
    });

    it("omits optional fields when not provided", async () => {
      mockPutSend.mockResolvedValue({});

      const logger = createDynamoAuditLogger(fakeTable);
      await logger.log({ userId: "U1", action: "login", status: "success" });

      const putArg = mockPutSend.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(putArg.toolName).toBeUndefined();
      expect(putArg.inputKeys).toBeUndefined();
      expect(putArg.durationMs).toBeUndefined();
      expect(putArg.errorMessage).toBeUndefined();
    });

    it("stores errorMessage when provided", async () => {
      mockPutSend.mockResolvedValue({});

      const logger = createDynamoAuditLogger(fakeTable);
      await logger.log({
        userId: "U1",
        action: "injection_suspected",
        status: "denied",
        errorMessage: "output contains credential-like string",
      });

      const putArg = mockPutSend.mock.calls[0]?.[0] as { errorMessage: string };
      expect(putArg.errorMessage).toBe("output contains credential-like string");
    });
  });

  describe("query", () => {
    it("uses GSI1 when userId is provided", async () => {
      mockQuerySend.mockResolvedValue({ Items: [] });

      const logger = createDynamoAuditLogger(fakeTable);
      await logger.query({ userId: "U123" });

      const queryArg = mockQuerySend.mock.calls[0]?.[0] as {
        index: string;
        partition: string;
      };
      expect(queryArg.index).toBe("gsi1");
      expect(queryArg.partition).toBe("AUDIT_USER#U123");
    });

    it("uses Scan when no userId is provided", async () => {
      mockScanSend.mockResolvedValue({ Items: [] });

      const logger = createDynamoAuditLogger(fakeTable);
      await logger.query({});

      expect(mockScanSend).toHaveBeenCalled();
      expect(mockQuerySend).not.toHaveBeenCalled();
    });

    it("deserializes inputKeys from JSON string", async () => {
      mockQuerySend.mockResolvedValue({
        Items: [
          {
            timestamp: 1000,
            userId: "U1",
            action: "tool_call",
            toolName: "github_search",
            inputKeys: '["query","repo"]',
            status: "success",
          },
        ],
      });

      const logger = createDynamoAuditLogger(fakeTable);
      const entries = await logger.query({ userId: "U1" });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.inputKeys).toEqual(["query", "repo"]);
    });

    it("filters by action when provided", async () => {
      mockQuerySend.mockResolvedValue({
        Items: [
          { timestamp: 2000, userId: "U1", action: "tool_call", status: "success" },
          { timestamp: 1000, userId: "U1", action: "login", status: "success" },
        ],
      });

      const logger = createDynamoAuditLogger(fakeTable);
      const entries = await logger.query({ userId: "U1", action: "login" });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.action).toBe("login");
    });

    it("sorts results newest first", async () => {
      mockQuerySend.mockResolvedValue({
        Items: [
          { timestamp: 1000, userId: "U1", action: "login", status: "success" },
          { timestamp: 3000, userId: "U1", action: "tool_call", status: "success" },
          { timestamp: 2000, userId: "U1", action: "config_change", status: "success" },
        ],
      });

      const logger = createDynamoAuditLogger(fakeTable);
      const entries = await logger.query({ userId: "U1" });

      expect(entries[0]?.timestamp).toBe(3000);
      expect(entries[1]?.timestamp).toBe(2000);
      expect(entries[2]?.timestamp).toBe(1000);
    });

    it("respects limit", async () => {
      mockQuerySend.mockResolvedValue({
        Items: [
          { timestamp: 1000, userId: "U1", action: "login", status: "success" },
          { timestamp: 2000, userId: "U1", action: "tool_call", status: "success" },
          { timestamp: 3000, userId: "U1", action: "config_change", status: "success" },
        ],
      });

      const logger = createDynamoAuditLogger(fakeTable);
      const entries = await logger.query({ userId: "U1", limit: 2 });

      expect(entries).toHaveLength(2);
    });
  });
});
