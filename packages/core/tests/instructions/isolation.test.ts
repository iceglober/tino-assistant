import { describe, expect, it } from "vitest";
import {
  filterToolResults,
  type InstanceIsolationConfig,
  type ToolResult,
} from "../../src/instructions/per-instance-isolation.js";

describe("per-instance isolation — filterToolResults", () => {
  it("tool result from instance A is visible in context A", () => {
    const results: ToolResult[] = [{ instanceId: "linear-internal", data: { issues: [1, 2] } }];
    const configs = new Map<string, InstanceIsolationConfig>();
    configs.set("linear-internal", { instanceId: "linear-internal", canShareWith: [] });

    const filtered = filterToolResults("linear-internal", results, configs);
    expect(filtered[0].filtered).toBe(false);
    expect(filtered[0].data).toEqual({ issues: [1, 2] });
  });

  it("tool result from instance B is filtered when canShareWith excludes A", () => {
    const results: ToolResult[] = [{ instanceId: "linear-customer", data: { issues: [3] } }];
    const configs = new Map<string, InstanceIsolationConfig>();
    configs.set("linear-customer", { instanceId: "linear-customer", canShareWith: [] });

    const filtered = filterToolResults("linear-internal", results, configs);
    expect(filtered[0].filtered).toBe(true);
    expect(filtered[0].data).toBeNull();
    expect(filtered[0].reason).toContain("isolated by canShareWith");
  });

  it("tool result from instance B is visible when canShareWith includes A", () => {
    const results: ToolResult[] = [{ instanceId: "linear-customer", data: { issues: [3] } }];
    const configs = new Map<string, InstanceIsolationConfig>();
    configs.set("linear-customer", {
      instanceId: "linear-customer",
      canShareWith: ["linear-internal"],
    });

    const filtered = filterToolResults("linear-internal", results, configs);
    expect(filtered[0].filtered).toBe(false);
    expect(filtered[0].data).toEqual({ issues: [3] });
  });

  it("instance with no isolation config is not filtered", () => {
    const results: ToolResult[] = [{ instanceId: "github-main", data: { prs: [] } }];
    const configs = new Map<string, InstanceIsolationConfig>();

    const filtered = filterToolResults("linear-internal", results, configs);
    expect(filtered[0].filtered).toBe(false);
  });

  it("mixed results: some filtered, some not", () => {
    const results: ToolResult[] = [
      { instanceId: "linear-internal", data: { a: 1 } },
      { instanceId: "linear-customer", data: { b: 2 } },
      { instanceId: "github-main", data: { c: 3 } },
    ];
    const configs = new Map<string, InstanceIsolationConfig>();
    configs.set("linear-customer", { instanceId: "linear-customer", canShareWith: [] });

    const filtered = filterToolResults("linear-internal", results, configs);
    expect(filtered[0].filtered).toBe(false);
    expect(filtered[1].filtered).toBe(true);
    expect(filtered[2].filtered).toBe(false);
  });
});
