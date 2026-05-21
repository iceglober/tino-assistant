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
  version: 2,
  email: { privateFolders: ["Private"], denyListedAddresses: ["therapist@example.com"] },
  messaging: { denyListedConversationIds: ["D_THERAPIST"], denyListedUserIds: ["U_THERAPIST"] },
  calendar: { defaultVisibility: "public", gateAllByDefault: false },
  lastReviewedAt: Date.now(),
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

    const raw = await configStore.get("user.user-1.privacy_config");
    expect(raw).not.toBeNull();

    await configStore.set("user.user-2.privacy_config", JSON.parse(raw!));

    const result = await store.get("user-2");
    expect(result).toBeNull();
  });

  it("lazy-migrates v1 config to v2 on read", async () => {
    const crypto = new LocalAdapter();
    const configStore = makeConfigStore();
    const store = createPrivacyConfigStore({ configStore, crypto });

    const v1Config = {
      version: 1,
      gmail: { privateLabels: ["Private", "HR"], denyListedAddresses: ["therapist@example.com"], threadingMode: "conservative" },
      slack: { denyListedConversationIds: ["D_THERAPIST"], denyListedUserIds: ["U_THERAPIST"], multiPartyMode: "conservative" },
      calendar: { defaultVisibility: "confidential", gateAllByDefault: true },
      lastReviewedAt: 1700000000000,
      lastRepromptAt: null,
    };

    const plaintext = JSON.stringify(v1Config);
    const envelope = await crypto.encrypt(plaintext, { userId: "user-1", capabilityId: "privacy_config", fieldName: "config" });
    await configStore.set("user.user-1.privacy_config", envelope);

    const result = await store.get("user-1");
    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    expect(result!.email).toEqual({ privateFolders: ["Private", "HR"], denyListedAddresses: ["therapist@example.com"] });
    expect(result!.messaging).toEqual({ denyListedConversationIds: ["D_THERAPIST"], denyListedUserIds: ["U_THERAPIST"] });
    expect(result!.calendar).toEqual({ defaultVisibility: "private", gateAllByDefault: true });
    expect(result!.lastReviewedAt).toBe(1700000000000);
    expect((result as any).lastRepromptAt).toBeUndefined();
    expect((result as any).gmail).toBeUndefined();
    expect((result as any).slack).toBeUndefined();
  });

  it("computeDelta detects added folders", () => {
    const crypto = new LocalAdapter();
    const store = createPrivacyConfigStore({ configStore: makeConfigStore(), crypto });

    const current: PrivacyConfig = {
      version: 2,
      email: { privateFolders: ["Private"], denyListedAddresses: [] },
      lastReviewedAt: 0,
    };
    const proposed: PrivacyConfig = {
      ...current,
      email: { privateFolders: ["Private", "HR"], denyListedAddresses: ["therapist@example.com"] },
    };

    const delta = store.computeDelta(current, proposed);
    expect(delta.email?.addedFolders).toEqual(["HR"]);
    expect(delta.email?.addedAddresses).toEqual(["therapist@example.com"]);
    expect(store.isAdditive(delta)).toBe(true);
  });

  it("isAdditive returns false for removals only", () => {
    const crypto = new LocalAdapter();
    const store = createPrivacyConfigStore({ configStore: makeConfigStore(), crypto });

    const current: PrivacyConfig = {
      version: 2,
      email: { privateFolders: ["Private", "HR"], denyListedAddresses: [] },
      lastReviewedAt: 0,
    };
    const proposed: PrivacyConfig = {
      ...current,
      email: { privateFolders: ["Private"], denyListedAddresses: [] },
    };

    const delta = store.computeDelta(current, proposed);
    expect(delta.email?.removedFolders).toEqual(["HR"]);
    expect(store.isAdditive(delta)).toBe(false);
  });
});
