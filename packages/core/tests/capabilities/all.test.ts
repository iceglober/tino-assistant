/**
 * Tests for the capability module list.
 *
 * Verifies that all capabilities are correctly classified (shared vs private)
 * and have the required interfaces for their scope.
 */

import { describe, it, expect } from "vitest";
import { ALL_CAPABILITIES } from "../../src/capabilities/all.js";

describe("ALL_CAPABILITIES", () => {
  it("all capabilities have a scope field", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(cap).toHaveProperty("scope");
      expect(["shared", "private"]).toContain(cap.scope);
    }
  });

  it("shared capabilities expose registerTools", () => {
    for (const cap of ALL_CAPABILITIES) {
      if (cap.scope === "shared") {
        expect(cap).toHaveProperty("registerTools");
        expect(typeof cap.registerTools).toBe("function");
      }
    }
  });

  it("private capabilities expose buildToolsForUser", () => {
    for (const cap of ALL_CAPABILITIES) {
      if (cap.scope === "private") {
        expect(cap).toHaveProperty("buildToolsForUser");
        expect(typeof cap.buildToolsForUser).toBe("function");
      }
    }
  });

  it("slack and slack-personal are separate modules", () => {
    const ids = ALL_CAPABILITIES.map((c) => c.id);
    expect(ids).toContain("slack");
    expect(ids).toContain("slack-personal");
    expect(ids.indexOf("slack")).not.toBe(ids.indexOf("slack-personal"));
  });

  it("slack is shared and slack-personal is private", () => {
    const slack = ALL_CAPABILITIES.find((c) => c.id === "slack");
    const slackPersonal = ALL_CAPABILITIES.find((c) => c.id === "slack-personal");

    expect(slack?.scope).toBe("shared");
    expect(slackPersonal?.scope).toBe("private");
  });

  it("gmail and calendar are private", () => {
    const gmail = ALL_CAPABILITIES.find((c) => c.id === "gmail");
    const calendar = ALL_CAPABILITIES.find((c) => c.id === "calendar");

    expect(gmail?.scope).toBe("private");
    expect(calendar?.scope).toBe("private");
  });

  it("github, linear, cloudwatch are shared", () => {
    const github = ALL_CAPABILITIES.find((c) => c.id === "github");
    const linear = ALL_CAPABILITIES.find((c) => c.id === "linear");
    const cloudwatch = ALL_CAPABILITIES.find((c) => c.id === "cloudwatch");

    expect(github?.scope).toBe("shared");
    expect(linear?.scope).toBe("shared");
    expect(cloudwatch?.scope).toBe("shared");
  });
});
