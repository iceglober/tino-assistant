/**
 * Wave 1 — capability module test for `slack` (shared).
 *
 * Verifies:
 *   - `registerTools()` is a no-op (no tools registered in wave 1).
 *   - xoxp-scoped user tools have been extracted to slack-personal.ts.
 *
 * Future waves will add bot-token (xoxb-) public-channel search tools here.
 */

import type { ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { slackCapability } from "../../src/capabilities/slack.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { makeConfigStore, makeLogger } from "./_helpers.js";

const EMPTY_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {},
  settings: {},
};

describe("slackCapability.registerTools", () => {
  it("is a no-op shared capability in wave 1", async () => {
    const tools: ToolSet = {};
    const toolsBefore = Object.keys(tools).length;
    await slackCapability.registerTools(EMPTY_CONFIG, makeConfigStore(), makeLogger(), tools);
    const toolsAfter = Object.keys(tools).length;

    // No tools should be registered
    expect(toolsAfter).toBe(toolsBefore);
    expect(Object.keys(tools)).not.toContain("slack_search_messages");
    expect(Object.keys(tools)).not.toContain("slack_read_thread");
    expect(Object.keys(tools)).not.toContain("slack_list_dms");
    expect(Object.keys(tools)).not.toContain("slack_read_dm");
  });
});
