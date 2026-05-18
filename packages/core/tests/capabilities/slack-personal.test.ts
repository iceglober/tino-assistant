/**
 * Wave 1 — capability module test for `slack-personal` (private).
 *
 * Verifies:
 *   - `buildToolsForUser()` with a `userToken` returns all four slack_* tools.
 *   - `buildToolsForUser()` returns null when config is null (not connected).
 *   - `buildToolsForUser()` returns null when credentials.userToken is missing.
 *
 * Mocks both `@slack/bolt` (so no real `WebClient` is constructed) and
 * `createUserCache` (which would otherwise call `users.list` on init).
 */

import { describe, expect, it, vi } from "vitest";
import { slackPersonalCapability } from "../../src/capabilities/slack-personal.js";
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

describe("slackPersonalCapability.buildToolsForUser", () => {
  it("returns all four slack_* tools when given a userToken", async () => {
    const tools = await slackPersonalCapability.buildToolsForUser("user123", GOOD_CONFIG, makeConfigStore(), makeLogger());
    expect(tools).not.toBeNull();

    const registered = Object.keys(tools!);
    expect(registered).toContain("slack_search_messages");
    expect(registered).toContain("slack_read_thread");
    expect(registered).toContain("slack_list_dms");
    expect(registered).toContain("slack_read_dm");
  });

  it("returns null when config is null", async () => {
    const tools = await slackPersonalCapability.buildToolsForUser("user123", null, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });

  it("returns null when credentials.userToken is missing", async () => {
    const tools = await slackPersonalCapability.buildToolsForUser("user123", BAD_CONFIG, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });
});
