/**
 * Wave 3 (v2.2) — § 3.2 capability module test for `cloudwatch`.
 *
 * Verifies:
 *   - `registerTools()` registers `cloudwatch_logs_query`.
 *
 * Unlike github/linear/google/slack, cloudwatch has no credential
 * requirements (it relies on the AWS default credential chain). The
 * capability accepts an empty config and still registers its tool;
 * runtime auth happens lazily inside the tool's handler.
 *
 * Mocks `@aws-sdk/client-cloudwatch-logs` and `@aws-sdk/credential-providers`
 * so no real AWS client is constructed at module load.
 */

import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { cloudwatchCapability } from "../../src/capabilities/cloudwatch.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { makeConfigStore, makeLogger } from "./_helpers.js";

vi.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  CloudWatchLogsClient: class FakeClient {},
}));

vi.mock("@aws-sdk/credential-providers", () => ({
  fromNodeProviderChain: () => () => Promise.resolve({}),
}));

describe("cloudwatchCapability.registerTools", () => {
  it("registers cloudwatch_logs_query with default settings", async () => {
    const config: CapabilityConfig = {
      enabled: true,
      credentials: {},
      settings: { region: "us-east-1", logGroups: ["/aws/ecs/tino"] },
    };
    const tools: ToolSet = {};
    await cloudwatchCapability.registerTools(config, makeConfigStore(), makeLogger(), tools);

    expect(Object.keys(tools)).toContain("cloudwatch_logs_query");
  });

  it("registers cloudwatch_logs_query even with an empty allowlist", async () => {
    const config: CapabilityConfig = {
      enabled: true,
      credentials: {},
      settings: {},
    };
    const tools: ToolSet = {};
    await cloudwatchCapability.registerTools(config, makeConfigStore(), makeLogger(), tools);

    // The tool is still registered — guard rails live inside the tool's
    // handler, not in registration. (Mirrors the source: there is no
    // `if (!allowedLogGroups.length) throw` check.)
    expect(Object.keys(tools)).toContain("cloudwatch_logs_query");
  });
});
