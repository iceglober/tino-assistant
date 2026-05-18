/**
 * DynamoDB user capability store adapter tests.
 *
 * Tests verify adapter wiring: correct key construction (pk=USER#<uid>, sk=CAP#<capId>),
 * query parameters for list(), and encryption/decryption plumbing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "@tino/core/crypto/types";
import type { CapabilityConfig } from "@tino/core/capabilities/types";

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
    createUserCapabilityEntity: () => mockEntity,
  };
});

// ── Stub CryptoAdapter ──────────────────────────────────────────────────────

class StubCryptoAdapter implements CryptoAdapter {
  async encrypt(plaintext: string, context: EncryptionContext): Promise<EnvelopeCiphertext> {
    const contextMarker = JSON.stringify(context);
    return {
      algorithm: "AES-256-GCM/v1",
      ciphertext: Buffer.from(plaintext).toString("base64"),
      authTag: Buffer.from(contextMarker).toString("base64"),
      iv: Buffer.alloc(12).toString("base64"),
    };
  }

  async decrypt(envelope: EnvelopeCiphertext, context: EncryptionContext): Promise<string> {
    const expectedMarker = JSON.stringify(context);
    const actualMarker = Buffer.from(envelope.authTag, "base64").toString();

    if (actualMarker !== expectedMarker) {
      throw new Error("context mismatch");
    }

    return Buffer.from(envelope.ciphertext, "base64").toString();
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────────

const mockTableBuild = vi.fn();
const fakeTable = {
  build: mockTableBuild,
} as unknown as Parameters<
  typeof import("../../src/persistence/dynamo/user-capabilities.js")["createDynamoUserCapabilityStore"]
>[0];

const { createDynamoUserCapabilityStore } = await import("../../src/persistence/dynamo/user-capabilities.js");

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("createDynamoUserCapabilityStore", () => {
  let cryptoAdapter: CryptoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTableBuild.mockImplementation((CommandClass: new () => unknown) => {
      return new (CommandClass as new () => unknown)();
    });
    cryptoAdapter = new StubCryptoAdapter();
  });

  it("get: uses pk=USER#<userId>, sk=CAP#<capabilityId>", async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    const result = await store.get("user-123", "github");

    expect(mockGetSend).toHaveBeenCalledWith({ pk: "USER#user-123", sk: "CAP#github" });
    expect(result).toBeNull();
  });

  it("get: decrypts credentials from encrypted record", async () => {
    const credentialsJson = JSON.stringify({
      token: {
        algorithm: "AES-256-GCM/v1",
        ciphertext: Buffer.from("my-secret-token").toString("base64"),
        authTag: Buffer.from(
          JSON.stringify({ userId: "user-123", capabilityId: "github", fieldName: "token" }),
        ).toString("base64"),
        iv: Buffer.alloc(12).toString("base64"),
      },
    });

    mockGetSend.mockResolvedValue({
      Item: {
        enabled: 1,
        credentialsJson,
        settingsJson: "{}",
      },
    });

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    const result = await store.get("user-123", "github");

    expect(result).toEqual({
      enabled: true,
      credentials: { token: "my-secret-token" },
      settings: {},
    });
  });

  it("set: uses pk=USER#<userId>, sk=CAP#<capabilityId> and encrypts credentials", async () => {
    mockPutSend.mockResolvedValue({});

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    const config: CapabilityConfig = {
      enabled: true,
      credentials: { token: "secret-token" },
      settings: { repos: ["repo1"] },
    };

    await store.set("user-123", "github", config);

    const putArg = mockPutSend.mock.calls[0]?.[0] as {
      pk: string;
      sk: string;
      tinoUserId: string;
      capabilityId: string;
      enabled: number;
      credentialsJson: string;
      settingsJson: string;
      updatedAt: number;
    };

    expect(putArg.pk).toBe("USER#user-123");
    expect(putArg.sk).toBe("CAP#github");
    expect(putArg.tinoUserId).toBe("user-123");
    expect(putArg.capabilityId).toBe("github");
    expect(putArg.enabled).toBe(1);
    expect(typeof putArg.updatedAt).toBe("number");

    // Verify credentials were encrypted
    const credentialsJson = JSON.parse(putArg.credentialsJson) as Record<string, EnvelopeCiphertext>;
    expect(credentialsJson.token).toBeDefined();
    expect(credentialsJson.token.algorithm).toBe("AES-256-GCM/v1");
    expect(credentialsJson.token.ciphertext).toBeDefined();
    expect(credentialsJson.token.authTag).toBeDefined();
  });

  it("list: queries pk=USER#<userId> with sk beginsWith CAP#", async () => {
    mockQuerySend.mockResolvedValue({ Items: [] });

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    await store.list("user-123");

    const queryArg = mockQuerySend.mock.calls[0]?.[0] as {
      partition: string;
      range: { beginsWith: string };
    };

    expect(queryArg.partition).toBe("USER#user-123");
    expect(queryArg.range.beginsWith).toBe("CAP#");
  });

  it("list: strips CAP# prefix from sk to get capabilityId", async () => {
    mockQuerySend.mockResolvedValue({
      Items: [
        { sk: "CAP#github", enabled: 1 },
        { sk: "CAP#linear", enabled: 0 },
      ],
    });

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    const capabilities = await store.list("user-123");

    expect(capabilities).toHaveLength(2);
    // Sorted alphabetically
    expect(capabilities[0]).toEqual({ capabilityId: "github", enabled: true });
    expect(capabilities[1]).toEqual({ capabilityId: "linear", enabled: false });
  });

  it("delete: returns false on GetItem miss", async () => {
    mockGetSend.mockResolvedValue({ Item: null });

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    const result = await store.delete("user-123", "github");

    expect(result).toBe(false);
    expect(mockDeleteSend).not.toHaveBeenCalled();
  });

  it("delete: returns true and calls DeleteItem on GetItem hit", async () => {
    mockGetSend.mockResolvedValue({ Item: { enabled: 1 } });
    mockDeleteSend.mockResolvedValue({});

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    const result = await store.delete("user-123", "github");

    expect(result).toBe(true);
    expect(mockDeleteSend).toHaveBeenCalledWith({ pk: "USER#user-123", sk: "CAP#github" });
  });

  it("list returns only capabilityId and enabled (no credentials)", async () => {
    mockQuerySend.mockResolvedValue({
      Items: [
        {
          sk: "CAP#github",
          enabled: 1,
          credentialsJson: '{"token": {"ciphertext": "...", ...}}',
          settingsJson: "{}",
        },
      ],
    });

    const store = createDynamoUserCapabilityStore(fakeTable, cryptoAdapter);
    const capabilities = await store.list("user-123");

    expect(capabilities[0]).toEqual({ capabilityId: "github", enabled: true });
    expect(capabilities[0]).not.toHaveProperty("credentials");
    expect(capabilities[0]).not.toHaveProperty("settings");
  });
});
