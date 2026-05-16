/**
 * Wave 3 (v2.2) — § 3.2 capability module test for `linear`.
 *
 * Verifies:
 *   - `registerTools()` with valid credentials registers all six linear_* tools.
 *     (Plan says "7 linear tools" but the source registers six —
 *     linear_search_issues, linear_get_issue, linear_create_issue,
 *     linear_update_issue, linear_add_comment, linear_list_my_issues.
 *     Asserting the actual surface keeps the test honest.)
 *   - `registerTools()` with an empty credentials bag throws.
 *
 * Mocks `@linear/sdk` at module level so no real client is constructed.
 */

import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { linearCapability } from "../../src/capabilities/linear.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { makeConfigStore, makeLogger } from "./_helpers.js";

vi.mock("@linear/sdk", () => ({
  LinearClient: class FakeLinearClient {},
}));

const GOOD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: "lin_api_test" },
  settings: { defaultTeamKey: "GEN" },
  findWork: { enabled: false, intervalMinutes: 15 },
};

const BAD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {},
  settings: {},
};

describe("linearCapability.registerTools", () => {
  it("registers all linear_* tools when given a token", async () => {
    const tools: ToolSet = {};
    await linearCapability.registerTools(GOOD_CONFIG, makeConfigStore(), makeLogger(), tools);

    const registered = Object.keys(tools);
    expect(registered).toContain("linear_search_issues");
    expect(registered).toContain("linear_get_issue");
    expect(registered).toContain("linear_create_issue");
    expect(registered).toContain("linear_update_issue");
    expect(registered).toContain("linear_add_comment");
    expect(registered).toContain("linear_list_my_issues");
  });

  it("throws when credentials.token is missing", async () => {
    const tools: ToolSet = {};
    await expect(linearCapability.registerTools(BAD_CONFIG, makeConfigStore(), makeLogger(), tools)).rejects.toThrow(
      /token/i,
    );
    expect(Object.keys(tools)).toHaveLength(0);
  });
});
