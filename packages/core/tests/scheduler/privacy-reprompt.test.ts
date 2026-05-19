import { describe, expect, it, vi } from "vitest";
import { checkPrivacyReprompt } from "../../src/scheduler/privacy-reprompt.js";
import type { PrivacyConfig } from "../../src/privacy/types.js";

const stubLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const baseConfig: PrivacyConfig = {
  version: 1,
  gmail: { privateLabels: ["Private"], denyListedAddresses: [], threadingMode: "conservative" },
  slack: { denyListedConversationIds: [], denyListedUserIds: [], multiPartyMode: "conservative" },
  calendar: { defaultVisibility: "public", gateAllByDefault: false },
  lastReviewedAt: Date.now(),
  lastRepromptAt: null,
};

describe("privacy re-prompt", () => {
  it("new contact matching regex emits a reprompt", async () => {
    const signals = await checkPrivacyReprompt({
      userId: "user-1",
      config: baseConfig,
      getRecentGmailContacts: async () => [
        { email: "doctor@example.com", name: "Dr. Smith" },
        { email: "alice@work.com", name: "Alice" },
      ],
      logger: stubLogger,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe("new_contact");
    expect(signals[0].description).toContain("Dr. Smith");
  });

  it("new dm participant matching regex emits a reprompt", async () => {
    const signals = await checkPrivacyReprompt({
      userId: "user-1",
      config: baseConfig,
      getRecentSlackDms: async () => [
        { userId: "U1", userName: "Dr. Medical" },
        { userId: "U2", userName: "Bob" },
      ],
      logger: stubLogger,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe("new_dm_participant");
    expect(signals[0].description).toContain("Dr. Medical");
  });

  it("calendar default visibility change emits a reprompt", async () => {
    const signals = await checkPrivacyReprompt({
      userId: "user-1",
      config: baseConfig,
      getCalendarVisibility: async () => "private",
      logger: stubLogger,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe("visibility_change");
    expect(signals[0].description).toContain("public");
    expect(signals[0].description).toContain("private");
  });

  it("reprompt cadence honors per-user setting (no signals when contacts already deny-listed)", async () => {
    const config: PrivacyConfig = {
      ...baseConfig,
      gmail: { privateLabels: ["Private"], denyListedAddresses: ["doctor@example.com"], threadingMode: "conservative" },
    };

    const signals = await checkPrivacyReprompt({
      userId: "user-1",
      config,
      getRecentGmailContacts: async () => [
        { email: "doctor@example.com", name: "Dr. Smith" },
      ],
      logger: stubLogger,
    });

    expect(signals).toHaveLength(0);
  });
});
