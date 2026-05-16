/**
 * Tests for the env-to-capability migration.
 *
 * Tests that migration correctly reads legacy env vars and writes
 * capability configs to the config store.
 */
import { describe, expect, it, vi } from "vitest";
import { migrateEnvToCapabilities } from "../../src/capabilities/migration.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AppLogger } from "../../src/slack/app.js";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migrateEnvToCapabilities", () => {
  it("1. no env vars → nothing migrated, cloudwatch always written (no credentials needed)", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    const result = await migrateEnvToCapabilities({}, configStore, logger);

    // cloudwatch is always migrated (uses AWS default credential chain)
    expect(result.migrated).toContain("cloudwatch");
    // others skipped (no env vars)
    expect(result.skipped).toContain("github");
    expect(result.skipped).toContain("linear");
    expect(result.skipped).toContain("slack");
    expect(result.skipped).toContain("gmail");
    expect(result.skipped).toContain("calendar");
    expect(result.alreadyPresent).toEqual([]);
  });

  it("2. GITHUB_TOKEN set → github capability migrated with token and default repo", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    const result = await migrateEnvToCapabilities(
      { GITHUB_TOKEN: "ghp_test", GITHUB_DEFAULT_REPO: "owner/repo" },
      configStore,
      logger,
    );

    expect(result.migrated).toContain("github");

    // Verify the written config
    const raw = await configStore.get("capability.github");
    expect(raw).not.toBeNull();
    const config = JSON.parse(raw!) as CapabilityConfig;
    expect(config.enabled).toBe(true);
    expect(config.credentials.token).toBe("ghp_test");
    expect(config.settings.defaultRepo).toBe("owner/repo");
    expect(config.settings.repos).toContain("owner/repo");
  });

  it("3. LINEAR_DEVELOPER_TOKEN set → linear capability migrated with findWork enabled", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    const result = await migrateEnvToCapabilities({ LINEAR_DEVELOPER_TOKEN: "lin_api_test" }, configStore, logger);

    expect(result.migrated).toContain("linear");

    const raw = await configStore.get("capability.linear");
    const config = JSON.parse(raw!) as CapabilityConfig;
    expect(config.credentials.token).toBe("lin_api_test");
    expect(config.findWork?.enabled).toBe(true);
    expect(config.findWork?.intervalMinutes).toBe(15);
  });

  it("4. SLACK_USER_TOKEN set → slack capability migrated", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    await migrateEnvToCapabilities({ SLACK_USER_TOKEN: "xoxp-test-token" }, configStore, logger);

    const raw = await configStore.get("capability.slack");
    const config = JSON.parse(raw!) as CapabilityConfig;
    expect(config.credentials.userToken).toBe("xoxp-test-token");
  });

  it("5. Google OAuth vars set → gmail and calendar both migrated", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    const result = await migrateEnvToCapabilities(
      {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
        GOOGLE_OAUTH_REFRESH_TOKEN: "refresh-token",
      },
      configStore,
      logger,
    );

    expect(result.migrated).toContain("gmail");
    expect(result.migrated).toContain("calendar");

    const gmailRaw = await configStore.get("capability.gmail");
    const gmailConfig = JSON.parse(gmailRaw!) as CapabilityConfig;
    expect(gmailConfig.credentials.clientId).toBe("client-id");
    expect(gmailConfig.credentials.refreshToken).toBe("refresh-token");

    const calRaw = await configStore.get("capability.calendar");
    const calConfig = JSON.parse(calRaw!) as CapabilityConfig;
    expect(calConfig.settings.calendarId).toBe("primary");
  });

  it("6. all capabilities already present → nothing migrated (no-op)", async () => {
    const existing: Record<string, unknown> = {};
    for (const id of ["github", "linear", "slack", "gmail", "calendar", "cloudwatch"]) {
      existing[`capability.${id}`] = { enabled: true, credentials: {}, settings: {} };
    }
    const configStore = makeConfigStore(existing);
    const logger = makeLogger();

    const result = await migrateEnvToCapabilities(
      { GITHUB_TOKEN: "ghp_test", LINEAR_DEVELOPER_TOKEN: "lin_test" },
      configStore,
      logger,
    );

    expect(result.migrated).toEqual([]);
    expect(result.alreadyPresent).toHaveLength(6);
    // set() should NOT have been called
    expect(configStore.set).not.toHaveBeenCalled();
  });

  it("7. partial existing → only missing capabilities migrated", async () => {
    const configStore = makeConfigStore({
      "capability.github": { enabled: true, credentials: { token: "existing" }, settings: {} },
    });
    const logger = makeLogger();

    const result = await migrateEnvToCapabilities(
      { GITHUB_TOKEN: "new_token", LINEAR_DEVELOPER_TOKEN: "lin_test" },
      configStore,
      logger,
    );

    // github already present — not overwritten
    expect(result.alreadyPresent).toContain("github");
    expect(result.migrated).not.toContain("github");

    // linear was missing — migrated
    expect(result.migrated).toContain("linear");

    // Verify github config was NOT overwritten
    const raw = await configStore.get("capability.github");
    const config = JSON.parse(raw!) as CapabilityConfig;
    expect(config.credentials.token).toBe("existing");
  });

  it("8. AWS_REGION set → cloudwatch config includes region", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    await migrateEnvToCapabilities({ AWS_REGION: "us-east-1" }, configStore, logger);

    const raw = await configStore.get("capability.cloudwatch");
    const config = JSON.parse(raw!) as CapabilityConfig;
    expect(config.settings.region).toBe("us-east-1");
    expect(config.settings.logGroups).toEqual([]);
  });

  it("9. migration logs what was migrated", async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    await migrateEnvToCapabilities({ GITHUB_TOKEN: "ghp_test" }, configStore, logger);

    // Should log each migrated capability
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: "github" }),
      expect.stringContaining("migration"),
    );
  });
});
