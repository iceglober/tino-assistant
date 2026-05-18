/**
 * Tests for the user-model migration (wave 0).
 *
 * Tests that the migration correctly creates a tino user, links identities,
 * copies history/preferences/tasks, and is idempotent.
 */

import { describe, expect, it, vi } from "vitest";
import { migrateToUserModel } from "../../src/identity/migration.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { HistoryStore } from "../../src/agent/history.js";
import type { PreferencesStore } from "../../src/persistence/preferences.js";
import type { TaskStore } from "../../src/persistence/tasks.js";
import type { IdentityStore, UserStore } from "../../src/identity/store.js";
import type { AppLogger } from "../../src/slack/app.js";
import type { SlackWebClient } from "../../src/identity/resolver.js";
import { createSqliteUserStore, createSqliteIdentityStore } from "../../src/identity/store.js";
import { createPreferencesStore } from "../../src/persistence/preferences.js";
import { createTaskStore } from "../../src/persistence/tasks.js";
import { createConfigStore } from "../../src/persistence/config.js";
import { createHistoryStore } from "../../src/agent/history.js";
import { randomUUID } from "node:crypto";

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

function makeSlackClient(email: string): SlackWebClient {
  return {
    users: {
      info: vi.fn(async () => ({
        user: { profile: { email } },
      })),
    },
  };
}

function makeFailingSlackClient(): SlackWebClient {
  return {
    users: {
      info: vi.fn(async () => {
        throw new Error("slack api error");
      }),
    },
  };
}

// Create temporary in-memory stores for testing
function createTestStores() {
  const dbPath = `:memory:`;
  const users = createSqliteUserStore({ dbPath });
  const identities = createSqliteIdentityStore({ dbPath });
  const history = createHistoryStore({ cap: 40 });
  const preferences = createPreferencesStore({ dbPath });
  const tasks = createTaskStore({ dbPath });
  const config = createConfigStore({ dbPath });

  return { users, identities, history, preferences, tasks, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migrateToUserModel", () => {
  it("creates admin user and links identities", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeSlackClient("alice@example.com");
    const slackUserId = "U01234ABCDE";

    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    // Verify the migration marked completion
    const completedAt = await config.get("migration.user-model-v1.completedAt");
    expect(completedAt).not.toBeNull();

    // Verify the user was created
    const allUsers = await users.list();
    expect(allUsers).toHaveLength(1);
    const user = allUsers[0];
    expect(user.role).toBe("admin");
    expect(user.email).toBe("alice@example.com");
    expect(user.slackUserId).toBe(slackUserId);

    // Verify identities were linked
    const slackIdentity = await identities.resolve("slack", slackUserId);
    expect(slackIdentity).toBe(user.id);

    const googleIdentity = await identities.resolve("google", "alice@example.com");
    expect(googleIdentity).toBe(user.id);
  });

  it("copies history under tino-UUID key", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeSlackClient("bob@example.com");
    const slackUserId = "U02345BCDEF";

    // Seed some history under the slack user id
    const oldMessages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    await history.append(slackUserId, oldMessages as any);

    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    // Verify history was copied to the new tino-UUID
    const user = (await users.list())[0];
    const newHistory = await history.get(user.id);
    expect(newHistory).toHaveLength(2);
    expect(newHistory[0].content).toBe("hello");
    expect(newHistory[1].content).toBe("hi there");
  });

  it("copies preferences under tino-UUID key", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeSlackClient("charlie@example.com");
    const slackUserId = "U03456CDEFG";

    // Seed some preferences under the slack user id
    await preferences.set(slackUserId, "theme", "dark");
    await preferences.set(slackUserId, "timezone", "UTC");

    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    // Verify preferences were copied to the new tino-UUID
    const user = (await users.list())[0];
    const theme = await preferences.get(user.id, "theme");
    const timezone = await preferences.get(user.id, "timezone");
    expect(theme).toBe("dark");
    expect(timezone).toBe("UTC");
  });

  it("rewrites task.userId in place (via backup and skip for now)", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeSlackClient("dave@example.com");
    const slackUserId = "U04567DEFGH";

    // Seed some tasks under the slack user id
    const task1 = await tasks.create(slackUserId, "task 1", Math.floor(Date.now() / 1000) + 60);
    const task2 = await tasks.create(slackUserId, "task 2", Math.floor(Date.now() / 1000) + 120);

    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    // Verify backup config keys were created (wave 0 behavior: skip actual update)
    const backupKey = await config.list();
    const hasTaskBackup = backupKey.some((item) => item.key.startsWith("migration.tasks-backup."));
    expect(hasTaskBackup).toBe(true);

    // In wave 0, tasks stay under the old slack-id key (update method not available yet)
    const oldTasks = await tasks.listByUser(slackUserId);
    expect(oldTasks).toHaveLength(2);
    expect(oldTasks[0].id).toBe(task1.id);
    expect(oldTasks[1].id).toBe(task2.id);
  });

  it("leaves legacy records intact", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeSlackClient("eve@example.com");
    const slackUserId = "U05678EFGHI";

    // Seed old data
    await history.append(slackUserId, [{ role: "user", content: "old msg" }] as any);
    await preferences.set(slackUserId, "oldkey", "oldvalue");

    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    // Verify old records still exist
    const oldHistory = await history.get(slackUserId);
    expect(oldHistory).toHaveLength(1);
    expect(oldHistory[0].content).toBe("old msg");

    const oldPref = await preferences.get(slackUserId, "oldkey");
    expect(oldPref).toBe("oldvalue");
  });

  it("is idempotent on second run", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeSlackClient("frank@example.com");
    const slackUserId = "U06789FGHIJ";

    // First run
    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    const firstUser = (await users.list())[0];

    // Second run (should be a no-op)
    const logger2 = makeLogger();
    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger: logger2,
    });

    // Verify no new user was created
    const allUsers = await users.list();
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0].id).toBe(firstUser.id);

    // Verify the logger indicated early exit (debug call)
    expect(logger2.debug).toHaveBeenCalledWith("user-model migration already completed, skipping");
  });

  it("handles slack API failure gracefully (logs warn and returns)", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeFailingSlackClient();
    const slackUserId = "U07890GHIJK";

    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    // Verify no user was created
    const allUsers = await users.list();
    expect(allUsers).toHaveLength(0);

    // Verify completion marker was NOT set
    const completedAt = await config.get("migration.user-model-v1.completedAt");
    expect(completedAt).toBeNull();

    // Verify a warning was logged
    expect(logger.warn).toHaveBeenCalled();
  });

  it("handles case-insensitive email normalization", async () => {
    const { users, identities, history, preferences, tasks, config } = createTestStores();
    const logger = makeLogger();
    const slackClient = makeSlackClient("Grace@Example.COM");
    const slackUserId = "U08901HIJKL";

    await migrateToUserModel({
      configStore: config,
      users,
      identities,
      history,
      preferences,
      tasks,
      slackClient,
      allowedSlackUserId: slackUserId,
      logger,
    });

    // Verify email was lowercased
    const user = (await users.list())[0];
    expect(user.email).toBe("grace@example.com");

    // Verify google identity lookup is also lowercased
    const googleId = await identities.resolve("google", "grace@example.com");
    expect(googleId).toBe(user.id);
  });
});
