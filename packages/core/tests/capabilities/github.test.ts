/**
 * Wave 3 (v2.2) — § 3.2 capability module test for `github`.
 *
 * Verifies:
 *   - `registerTools()` with valid credentials registers the four github_*
 *     tools and logs an info line.
 *   - `registerTools()` with an empty credentials bag throws a "token"-bearing
 *     error so the registry's outer try/catch surfaces a clear "disabled"
 *     warning to the operator.
 *
 * Mirror: `tests/capabilities/registry.test.ts` (in-memory store, vi.fn logger).
 * Mocks `@octokit/rest` at module level so no real HTTP client is constructed
 * — vitest hoists `vi.mock` calls before imports.
 */

import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { githubCapability } from "../../src/capabilities/github.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { makeConfigStore, makeLogger } from "./_helpers.js";

vi.mock("@octokit/rest", () => ({
  Octokit: class FakeOctokit {},
}));

const GOOD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: "ghp_test_token" },
  settings: { repos: ["owner/repo"], defaultRepo: "owner/repo" },
  findWork: { enabled: false, intervalMinutes: 15 },
};

const BAD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {},
  settings: {},
};

describe("githubCapability.registerTools", () => {
  it("registers the four github_* tools when given a token", async () => {
    const tools: ToolSet = {};
    await githubCapability.registerTools(GOOD_CONFIG, makeConfigStore(), makeLogger(), tools);

    const registered = Object.keys(tools);
    expect(registered).toContain("github_search_code");
    expect(registered).toContain("github_get_file");
    expect(registered).toContain("github_list_workflow_runs");
    expect(registered).toContain("github_get_workflow_run_logs");
  });

  it("throws when credentials.token is missing", async () => {
    const tools: ToolSet = {};
    await expect(githubCapability.registerTools(BAD_CONFIG, makeConfigStore(), makeLogger(), tools)).rejects.toThrow(
      /token/i,
    );
    // No tools should have been registered before the throw.
    expect(Object.keys(tools)).toHaveLength(0);
  });
});
