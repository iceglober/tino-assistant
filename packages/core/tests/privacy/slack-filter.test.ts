import { describe, expect, it } from "vitest";
import { slackFilter } from "../../src/privacy/slack.js";
import type { SlackPrivacyConfig } from "../../src/privacy/types.js";

const baseConfig: SlackPrivacyConfig = {
  denyListedConversationIds: ["D_THERAPIST"],
  denyListedUserIds: ["U_THERAPIST"],
  multiPartyMode: "conservative",
};

describe("slack privacy filter", () => {
  it("deny-listed conversation id gates", () => {
    const result = slackFilter(
      { channel: "D_THERAPIST" },
      { messages: [{ user: "U_OTHER", ts: "1716100000.000" }] },
      baseConfig,
    );
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.placeholder.reason).toBe("deny_listed_dm");
      expect(result.placeholder.metadata.channelId).toBe("D_THERAPIST");
    }
  });

  it("deny-listed user in 1:1 DM gates", () => {
    const result = slackFilter(
      { channel: "D_SOME_CHANNEL" },
      { messages: [{ user: "U_THERAPIST", ts: "1716100000.000" }] },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("deny-listed user in MPIM gates whole MPIM", () => {
    const result = slackFilter(
      { channel: "G_GROUP" },
      {
        messages: [
          { user: "U_ALICE", ts: "1716100000.000" },
          { user: "U_THERAPIST", ts: "1716100001.000" },
          { user: "U_BOB", ts: "1716100002.000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("non-deny-listed conversation persists", () => {
    const result = slackFilter(
      { channel: "D_FRIEND" },
      { messages: [{ user: "U_FRIEND", ts: "1716100000.000" }] },
      baseConfig,
    );
    expect(result.persist).toBe(true);
  });

  it("deny-listed user in slack_list_dms result gates", () => {
    const result = slackFilter(
      {},
      {
        conversations: [
          { channelId: "D_NORMAL", userId: "U_ALICE", isGroup: false },
          { channelId: "D_PRIVATE", userId: "U_THERAPIST", isGroup: false },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("no config means persist", () => {
    const result = slackFilter(
      { channel: "D_THERAPIST" },
      { messages: [{ user: "U_THERAPIST", ts: "1716100000.000" }] },
      undefined,
    );
    expect(result.persist).toBe(true);
  });
});
