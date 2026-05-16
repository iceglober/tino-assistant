/**
 * Wave 3 (v2.2) — § 3.2 capability module test for `slack`.
 *
 * Verifies:
 *   - `registerTools()` with a `userToken` registers all four slack_* tools.
 *   - `registerTools()` throws when `userToken` is missing.
 *
 * Mocks both `@slack/bolt` (so no real `WebClient` is constructed) and
 * `createUserCache` (which would otherwise call `users.list` on init).
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

// userCache loads workspace users at startup; stub it so we don't hit
// the (mocked) WebClient and don't introduce timing flake.
vi.mock("../../src/slack/userCache.js", () => ({
  createUserCache: vi.fn().mockResolvedValue({
    nameById: new Map(),
    refresh: vi.fn(),
  }),
}));

const GOOD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { userToken: "xoxp-test-token" },
  settings: {},
};

const BAD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {},
  settings: {},
};

describe("slackCapability.registerTools", () => {
  it("registers all four slack_* tools when given a userToken", async () => {
    const tools: ToolSet = {};
    await slackCapability.registerTools(GOOD_CONFIG, makeConfigStore(), makeLogger(), tools);

    const registered = Object.keys(tools);
    expect(registered).toContain("slack_search_messages");
    expect(registered).toContain("slack_read_thread");
    expect(registered).toContain("slack_list_dms");
    expect(registered).toContain("slack_read_dm");
  });

  it("throws when credentials.userToken is missing", async () => {
    const tools: ToolSet = {};
    await expect(slackCapability.registerTools(BAD_CONFIG, makeConfigStore(), makeLogger(), tools)).rejects.toThrow(
      /userToken/,
    );
  });
});
