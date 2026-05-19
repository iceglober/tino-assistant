import { describe, expect, it, vi } from "vitest";
import { LocalAdapter } from "../../src/crypto/local-adapter.js";
import { createPrivacyConfigStore } from "../../src/privacy/config-store.js";
import type { PrivacyConfig } from "../../src/privacy/types.js";

function makeConfigStore() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getTyped: vi.fn(async <T>(_key: string, fallback: T): Promise<T> => fallback),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    }),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => false),
  };
}

const testConfig: PrivacyConfig = {
  version: 1,
  gmail: { privateLabels: ["Private"], denyListedAddresses: ["therapist@example.com"], threadingMode: "conservative" },
  slack: { denyListedConversationIds: ["D_THERAPIST"], denyListedUserIds: ["U_THERAPIST"], multiPartyMode: "conservative" },
  calendar: { defaultVisibility: "public", gateAllByDefault: false },
  lastReviewedAt: Date.now(),
  lastRepromptAt: null,
};

describe("PrivacyConfigStore", () => {
  it("set then get round-trips plaintext config", async () => {
    const crypto = new LocalAdapter();
    const configStore = makeConfigStore();
    const store = createPrivacyConfigStore({ configStore, crypto });

    await store.set("user-1", testConfig);
    const result = await store.get("user-1");

    expect(result).toEqual(testConfig);
  });

  it("different users do not share privacy config", async () => {
    const crypto = new LocalAdapter();
    const configStore = makeConfigStore();
    const store = createPrivacyConfigStore({ configStore, crypto });

    await store.set("user-1", testConfig);
    const user2Config = await store.get("user-2");

    expect(user2Config).toBeNull();
  });

  it("decrypt with wrong userId encryption context fails", async () => {
    const crypto = new LocalAdapter();
    const configStore = makeConfigStore();
    const store = createPrivacyConfigStore({ configStore, crypto });

    await store.set("user-1", testConfig);

    // Manually tamper: try to decrypt user-1's config as user-2
    const raw = await configStore.get("user.user-1.privacy_config");
    expect(raw).not.toBeNull();

    // Store user-1's encrypted blob under user-2's key
    await configStore.set("user.user-2.privacy_config", JSON.parse(raw!));

    // Attempt to read as user-2 — should fail (wrong encryption context)
    const result = await store.get("user-2");
    expect(result).toBeNull();
  });

  it("computeDelta detects added labels", () => {
    const crypto = new LocalAdapter();
    const store = createPrivacyConfigStore({ configStore: makeConfigStore(), crypto });

    const current: PrivacyConfig = {
      version: 1,
      gmail: { privateLabels: ["Private"], denyListedAddresses: [], threadingMode: "conservative" },
      lastReviewedAt: 0,
      lastRepromptAt: null,
    };
    const proposed: PrivacyConfig = {
      ...current,
      gmail: { privateLabels: ["Private", "HR"], denyListedAddresses: ["therapist@example.com"], threadingMode: "conservative" },
    };

    const delta = store.computeDelta(current, proposed);
    expect(delta.gmail?.addedLabels).toEqual(["HR"]);
    expect(delta.gmail?.addedAddresses).toEqual(["therapist@example.com"]);
    expect(store.isAdditive(delta)).toBe(true);
  });

  it("isAdditive returns false for removals only", () => {
    const crypto = new LocalAdapter();
    const store = createPrivacyConfigStore({ configStore: makeConfigStore(), crypto });

    const current: PrivacyConfig = {
      version: 1,
      gmail: { privateLabels: ["Private", "HR"], denyListedAddresses: [], threadingMode: "conservative" },
      lastReviewedAt: 0,
      lastRepromptAt: null,
    };
    const proposed: PrivacyConfig = {
      ...current,
      gmail: { privateLabels: ["Private"], denyListedAddresses: [], threadingMode: "conservative" },
    };

    const delta = store.computeDelta(current, proposed);
    expect(delta.gmail?.removedLabels).toEqual(["HR"]);
    expect(store.isAdditive(delta)).toBe(false);
  });
});
