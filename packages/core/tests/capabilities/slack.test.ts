/**
 * Capability module test for `slack` (shared).
 *
 * Verifies:
 *   - `registerTools()` registers 3 channel tools when bot token is present.
 *   - `registerTools()` is a no-op when no bot token is configured.
 *   - No personal tools (search, DMs) are registered — those are in slack-personal.
 */

import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { slackCapability } from "../../src/capabilities/slack.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { makeConfigStore, makeLogger } from "./_helpers.js";

vi.mock("@slack/bolt", () => ({
  webApi: {
    WebClient: class FakeWebClient {},
  },
}));

vi.mock("../../src/slack/userCache.js", () => ({
  createUserCache: vi.fn().mockResolvedValue({
    nameById: new Map(),
    refresh: vi.fn(),
  }),
}));

const EMPTY_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {},
  settings: {},
};

describe("slackCapability.registerTools", () => {
  it("registers no tools when bot token is missing", async () => {
    const tools: ToolSet = {};
    await slackCapability.registerTools(EMPTY_CONFIG, makeConfigStore(), makeLogger(), tools);

    expect(Object.keys(tools)).toHaveLength(0);
    expect(Object.keys(tools)).not.toContain("slack_search_messages");
    expect(Object.keys(tools)).not.toContain("slack_list_dms");
    expect(Object.keys(tools)).not.toContain("slack_read_dm");
  });

  it("registers 3 channel tools when bot token is present", async () => {
    const tools: ToolSet = {};
    const store = makeConfigStore({ "slack.botToken": "xoxb-test-token" });
    await slackCapability.registerTools(EMPTY_CONFIG, store, makeLogger(), tools);

    expect(Object.keys(tools)).toContain("slack_list_channels");
    expect(Object.keys(tools)).toContain("slack_read_channel");
    expect(Object.keys(tools)).toContain("slack_read_channel_thread");
    expect(Object.keys(tools)).toHaveLength(3);
  });
});
