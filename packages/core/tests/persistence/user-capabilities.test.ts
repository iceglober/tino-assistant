import { describe, it, expect, beforeEach } from "vitest";
import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "@tino/core/crypto/types";
import type { CapabilityConfig } from "@tino/core/capabilities/types";
import { createSqliteUserCapabilityStore } from "@tino/core/persistence/user-capabilities";

/**
 * Stub CryptoAdapter for testing — does identity crypto (no real encryption)
 * but binds context to prevent cross-context decryption via a marker.
 */
class StubCryptoAdapter implements CryptoAdapter {
  async encrypt(plaintext: string, context: EncryptionContext): Promise<EnvelopeCiphertext> {
    const contextMarker = JSON.stringify({ userId: context.userId, capabilityId: context.capabilityId, fieldName: context.fieldName });
    return {
      algorithm: "AES-256-GCM/v1",
      ciphertext: Buffer.from(plaintext).toString("base64"),
      authTag: Buffer.from(contextMarker).toString("base64"),
      iv: Buffer.alloc(12).toString("base64"),
    };
  }

  async decrypt(envelope: EnvelopeCiphertext, context: EncryptionContext): Promise<string> {
    const expectedContextMarker = JSON.stringify({ userId: context.userId, capabilityId: context.capabilityId, fieldName: context.fieldName });
    const actualContextMarker = Buffer.from(envelope.authTag, "base64").toString();

    if (actualContextMarker !== expectedContextMarker) {
      throw new Error("context mismatch: auth tag failed");
    }

    return Buffer.from(envelope.ciphertext, "base64").toString();
  }
}

describe("UserCapabilityStore (SQLite)", () => {
  let store: ReturnType<typeof createSqliteUserCapabilityStore>;
  let cryptoAdapter: CryptoAdapter;

  beforeEach(() => {
    cryptoAdapter = new StubCryptoAdapter();
    store = createSqliteUserCapabilityStore({
      dbPath: ":memory:",
      cryptoAdapter,
    });
  });

  it("set then get round-trips plaintext credentials", async () => {
    const userId = "user-1";
    const capabilityId = "github";
    const config: CapabilityConfig = {
      enabled: true,
      credentials: { token: "secret-token-123" },
      settings: { repos: ["repo1", "repo2"] },
    };

    await store.set(userId, capabilityId, config);
    const retrieved = await store.get(userId, capabilityId);

    expect(retrieved).toEqual(config);
  });

  it("different users do not share capability state", async () => {
    const user1Config: CapabilityConfig = {
      enabled: true,
      credentials: { token: "user1-token" },
      settings: {},
    };

    const user2Config: CapabilityConfig = {
      enabled: false,
      credentials: { token: "user2-token" },
      settings: {},
    };

    await store.set("user-1", "github", user1Config);
    await store.set("user-2", "github", user2Config);

    const retrieved1 = await store.get("user-1", "github");
    const retrieved2 = await store.get("user-2", "github");

    expect(retrieved1).toEqual(user1Config);
    expect(retrieved2).toEqual(user2Config);
  });

  it("list returns enabled flags only (does not decrypt)", async () => {
    const userId = "user-1";

    const githubConfig: CapabilityConfig = {
      enabled: true,
      credentials: { token: "github-token" },
      settings: {},
    };

    const linearConfig: CapabilityConfig = {
      enabled: false,
      credentials: { token: "linear-token" },
      settings: {},
    };

    await store.set(userId, "github", githubConfig);
    await store.set(userId, "linear", linearConfig);

    const list = await store.list(userId);

    expect(list).toEqual([
      { capabilityId: "github", enabled: true },
      { capabilityId: "linear", enabled: false },
    ]);
  });

  it("delete returns true on existing, false on missing", async () => {
    const userId = "user-1";
    const capabilityId = "github";

    const config: CapabilityConfig = {
      enabled: true,
      credentials: { token: "token" },
      settings: {},
    };

    await store.set(userId, capabilityId, config);

    const existingResult = await store.delete(userId, capabilityId);
    expect(existingResult).toBe(true);

    const missingResult = await store.delete(userId, capabilityId);
    expect(missingResult).toBe(false);
  });

  it("get returns null when nothing stored", async () => {
    const result = await store.get("user-1", "github");
    expect(result).toBeNull();
  });

  it("context mismatch prevents decryption", async () => {
    // Directly test that the stub adapter enforces context binding
    const context: EncryptionContext = {
      userId: "user-1",
      capabilityId: "github",
      fieldName: "token",
    };

    const plaintext = "secret-token";
    const envelope = await cryptoAdapter.encrypt(plaintext, context);

    // Try to decrypt with wrong context (should fail)
    const wrongContext: EncryptionContext = {
      userId: "user-1",
      capabilityId: "github",
      fieldName: "wrongField",
    };

    await expect(cryptoAdapter.decrypt(envelope, wrongContext)).rejects.toThrow("context mismatch");
  });

  it("stores multiple credentials per capability", async () => {
    const config: CapabilityConfig = {
      enabled: true,
      credentials: {
        apiKey: "key-123",
        apiSecret: "secret-456",
        refreshToken: "refresh-789",
      },
      settings: { workspace: "my-workspace" },
    };

    await store.set("user-1", "slack", config);
    const retrieved = await store.get("user-1", "slack");

    expect(retrieved?.credentials).toEqual(config.credentials);
  });

  it("upsert on existing record", async () => {
    const userId = "user-1";
    const capabilityId = "github";

    const config1: CapabilityConfig = {
      enabled: true,
      credentials: { token: "old-token" },
      settings: { repos: ["repo1"] },
    };

    const config2: CapabilityConfig = {
      enabled: false,
      credentials: { token: "new-token" },
      settings: { repos: ["repo1", "repo2"] },
    };

    await store.set(userId, capabilityId, config1);
    await store.set(userId, capabilityId, config2);

    const retrieved = await store.get(userId, capabilityId);
    expect(retrieved).toEqual(config2);
  });
});
