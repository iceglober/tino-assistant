/**
 * Integration tests for wave 2 credential migration.
 *
 * Tests that private-capability credentials are correctly migrated from
 * global `capability.<id>` blobs to per-user encrypted partitions, with
 * 30-day backups, and that the migration is idempotent.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { migrateCredentialsToUserPartitions } from "../../src/crypto/migration.js";
import { createCryptoAdapter } from "../../src/crypto/factory.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { UserCapabilityStore } from "../../src/persistence/user-capabilities.js";
import type { AppLogger } from "../../src/slack/app.js";
import type { IdentityStore, UserStore } from "../../src/identity/store.js";
import { createSqliteUserStore, createSqliteIdentityStore } from "../../src/identity/store.js";
import { createConfigStore } from "../../src/persistence/config.js";
import { createSqliteUserCapabilityStore } from "../../src/persistence/user-capabilities.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import type { TinoUser } from "../../src/identity/types.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeConfigStore(existing: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, string>(Object.entries(existing).map(([k, v]) => [k, JSON.stringify(v)]));

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getTyped: vi.fn(async <T>(key: string, fallback: T): Promise<T> => {
      const raw = store.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    }),
    list: vi.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value, updatedAt: Date.now() }))),
    delete: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had;
    }),
  };
}

function createTestStores(existingConfig: Record<string, unknown> = {}) {
  const dbPath = `:memory:`;
  const configStore = makeConfigStore(existingConfig);
  const users = createSqliteUserStore({ dbPath });
  const identities = createSqliteIdentityStore({ dbPath });

  return { configStore, users, identities, dbPath };
}

async function createCryptoAdapterAndStore(dbPath: string) {
  // Use local dev crypto for tests
  const cryptoAdapter = await createCryptoAdapter({
    KMS_KEY_ARN: undefined,
    LOCAL_DEV_CRYPTO_KEY: "test-key-for-testing-only-32bytes",
  } as any);

  const userCapabilities = createSqliteUserCapabilityStore({ dbPath, cryptoAdapter });
  return { cryptoAdapter, userCapabilities };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migrateCredentialsToUserPartitions", () => {
  it("1. no global configs → migration completes with no migrated capabilities", async () => {
    const { configStore, users } = createTestStores();
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    // Create an admin user
    const adminId = crypto.randomUUID();
    const now = Date.now();
    await users.create({
      id: adminId,
      email: "admin@example.com",
      role: "admin",
      status: "active",
      slackUserId: "U123",
      createdAt: now,
      updatedAt: now,
    });

    const result = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U123",
    });

    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.botOwnerTinoUserId).toBe(adminId);

    // Verify completion marker is NOT set (nothing to migrate)
    const marker = await configStore.get("migration.wave2-credential-v1.completedAt");
    expect(marker).toBeNull();
  });

  it("2. global gmail config → credentials encrypted and stored per-user", async () => {
    const gmailConfig: CapabilityConfig = {
      enabled: true,
      credentials: {
        clientId: "test-client-id.apps.googleusercontent.com",
        clientSecret: "test-client-secret",
        refreshToken: "test-refresh-token",
      },
      settings: {},
    };

    const { configStore, users } = createTestStores({
      "capability.gmail": gmailConfig,
    });
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    const adminId = crypto.randomUUID();
    const now = Date.now();
    await users.create({
      id: adminId,
      email: "admin@example.com",
      role: "admin",
      status: "active",
      slackUserId: "U123",
      createdAt: now,
      updatedAt: now,
    });

    const result = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U123",
    });

    expect(result.migrated).toContain("gmail");
    expect(result.botOwnerTinoUserId).toBe(adminId);

    // Verify global config was cleared
    const globalGmail = await configStore.get("capability.gmail");
    expect(globalGmail).toBeNull();

    // Verify backup was written with TTL
    expect(result.backupKeys).toHaveLength(1);
    const backupKey = result.backupKeys[0];
    expect(backupKey).toMatch(/^migration\.gmail-backup\.\d+$/);

    const backup = await configStore.get(backupKey);
    expect(backup).not.toBeNull();
    const backupObj = JSON.parse(backup!) as CapabilityConfig & {
      __backupCreatedAt: number;
      __ttlExpiresAt: number;
    };
    expect(backupObj.credentials).toEqual(gmailConfig.credentials);
    expect(backupObj.__ttlExpiresAt).toBeGreaterThan(Date.now());

    // Verify credentials are encrypted in user store (decrypt to verify roundtrip)
    const userConfig = await userCapabilities.get(adminId, "gmail");
    expect(userConfig).not.toBeNull();
    expect(userConfig!.credentials).toEqual(gmailConfig.credentials);
    expect(userConfig!.settings).toEqual(gmailConfig.settings);
    expect(userConfig!.enabled).toBe(true);

    // Verify completion marker
    const marker = await configStore.get("migration.wave2-credential-v1.completedAt");
    expect(marker).not.toBeNull();
  });

  it("3. all private capabilities → all migrated and cleared", async () => {
    const gmailConfig: CapabilityConfig = {
      enabled: true,
      credentials: {
        clientId: "gmail-client-id",
        clientSecret: "gmail-secret",
        refreshToken: "gmail-refresh",
      },
      settings: {},
    };

    const calendarConfig: CapabilityConfig = {
      enabled: true,
      credentials: {
        clientId: "calendar-client-id",
        clientSecret: "calendar-secret",
        refreshToken: "calendar-refresh",
      },
      settings: { calendarId: "primary" },
    };

    const slackPersonalConfig: CapabilityConfig = {
      enabled: false,
      credentials: {
        userToken: "xoxp-slack-token",
      },
      settings: {},
    };

    const { configStore, users } = createTestStores({
      "capability.gmail": gmailConfig,
      "capability.calendar": calendarConfig,
      "capability.slack-personal": slackPersonalConfig,
    });
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    const adminId = crypto.randomUUID();
    const now = Date.now();
    await users.create({
      id: adminId,
      email: "admin@example.com",
      role: "admin",
      status: "active",
      slackUserId: "U456",
      createdAt: now,
      updatedAt: now,
    });

    const result = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U456",
    });

    expect(result.migrated).toEqual(expect.arrayContaining(["gmail", "calendar", "slack-personal"]));
    expect(result.backupKeys).toHaveLength(3);

    // All global configs should be cleared
    expect(await configStore.get("capability.gmail")).toBeNull();
    expect(await configStore.get("capability.calendar")).toBeNull();
    expect(await configStore.get("capability.slack-personal")).toBeNull();

    // All should be in user store
    const gmailUser = await userCapabilities.get(adminId, "gmail");
    expect(gmailUser!.credentials.clientId).toBe("gmail-client-id");

    const calendarUser = await userCapabilities.get(adminId, "calendar");
    expect(calendarUser!.credentials.clientId).toBe("calendar-client-id");
    expect(calendarUser!.settings.calendarId).toBe("primary");

    const slackPersonalUser = await userCapabilities.get(adminId, "slack-personal");
    expect(slackPersonalUser!.credentials.userToken).toBe("xoxp-slack-token");
    expect(slackPersonalUser!.enabled).toBe(false);
  });

  it("4. invalid JSON in global config → capability skipped, migration continues", async () => {
    const { configStore, users } = createTestStores({
      "capability.gmail": "{ invalid json }",
      "capability.calendar": {
        enabled: true,
        credentials: { clientId: "id", clientSecret: "secret", refreshToken: "token" },
        settings: {},
      },
    });
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    const adminId = crypto.randomUUID();
    const now = Date.now();
    await users.create({
      id: adminId,
      email: "admin@example.com",
      role: "admin",
      status: "active",
      slackUserId: "U789",
      createdAt: now,
      updatedAt: now,
    });

    const result = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U789",
    });

    // gmail should be skipped (invalid JSON)
    expect(result.skipped).toContain("gmail");
    // calendar should be migrated
    expect(result.migrated).toContain("calendar");

    // gmail global config should still exist (not cleared due to parse error)
    expect(await configStore.get("capability.gmail")).not.toBeNull();

    // calendar should be cleared
    expect(await configStore.get("capability.calendar")).toBeNull();
  });

  it("5. empty credentials → skipped, not migrated", async () => {
    const { configStore, users } = createTestStores({
      "capability.gmail": {
        enabled: true,
        credentials: {},
        settings: {},
      },
      "capability.calendar": {
        enabled: true,
        credentials: {
          clientId: "id",
          clientSecret: "secret",
          refreshToken: "token",
        },
        settings: {},
      },
    });
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    const adminId = crypto.randomUUID();
    const now = Date.now();
    await users.create({
      id: adminId,
      email: "admin@example.com",
      role: "admin",
      status: "active",
      slackUserId: "U999",
      createdAt: now,
      updatedAt: now,
    });

    const result = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U999",
    });

    expect(result.skipped).toContain("gmail");
    expect(result.migrated).toContain("calendar");

    // gmail global should not be cleared (skipped)
    expect(await configStore.get("capability.gmail")).not.toBeNull();
  });

  it("6. migration idempotent → second call is no-op", async () => {
    const gmailConfig: CapabilityConfig = {
      enabled: true,
      credentials: {
        clientId: "id",
        clientSecret: "secret",
        refreshToken: "token",
      },
      settings: {},
    };

    const { configStore, users } = createTestStores({
      "capability.gmail": gmailConfig,
    });
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    const adminId = crypto.randomUUID();
    const now = Date.now();
    await users.create({
      id: adminId,
      email: "admin@example.com",
      role: "admin",
      status: "active",
      slackUserId: "U111",
      createdAt: now,
      updatedAt: now,
    });

    // First call
    const result1 = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U111",
    });

    expect(result1.migrated).toContain("gmail");

    // Global config should be cleared after first run
    expect(await configStore.get("capability.gmail")).toBeNull();

    // Second call — should be no-op
    const result2 = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U111",
    });

    expect(result2.migrated).toEqual([]);
    expect(result2.skipped).toEqual([]);

    // User config should still be accessible
    const userConfig = await userCapabilities.get(adminId, "gmail");
    expect(userConfig!.credentials).toEqual(gmailConfig.credentials);
  });

  it("7. no admin user → migration skipped gracefully", async () => {
    const { configStore, users } = createTestStores({
      "capability.gmail": {
        enabled: true,
        credentials: { clientId: "id", clientSecret: "secret", refreshToken: "token" },
        settings: {},
      },
    });
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    // Don't create any user

    const result = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      allowedSlackUserId: "U111",
    });

    expect(result.migrated).toEqual([]);
    expect(result.botOwnerTinoUserId).toBeUndefined();

    // Global config should NOT be cleared
    expect(await configStore.get("capability.gmail")).not.toBeNull();

    // No completion marker
    const marker = await configStore.get("migration.wave2-credential-v1.completedAt");
    expect(marker).toBeNull();
  });

  it("8. no allowedSlackUserId → migration skipped gracefully", async () => {
    const { configStore, users } = createTestStores({
      "capability.gmail": {
        enabled: true,
        credentials: { clientId: "id", clientSecret: "secret", refreshToken: "token" },
        settings: {},
      },
    });
    const { userCapabilities } = await createCryptoAdapterAndStore(":memory:");
    const logger = makeLogger();

    const adminId = crypto.randomUUID();
    const now = Date.now();
    await users.create({
      id: adminId,
      email: "admin@example.com",
      role: "admin",
      status: "active",
      slackUserId: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await migrateCredentialsToUserPartitions({
      configStore,
      userCapabilities,
      users,
      logger,
      // No allowedSlackUserId
    });

    expect(result.migrated).toEqual([]);

    // Global config should NOT be cleared
    expect(await configStore.get("capability.gmail")).not.toBeNull();
  });
});
