import { describe, expect, it } from "vitest";
import { resolveInstructions } from "../../src/instructions/resolver.js";
import type { Instruction } from "../../src/instructions/types.js";

describe("resolveInstructions", () => {
  it("empty input returns default permissions", () => {
    const result = resolveInstructions([]);
    expect(result.permissions).toEqual({ write: true, delete: true, crossContextShare: true });
    expect(result.behaviorChunks).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("single org-level write:false sets write to false", () => {
    const result = resolveInstructions([
      { level: "org", source: "org-policy", permissions: { write: false } },
    ]);
    expect(result.permissions.write).toBe(false);
    expect(result.permissions.delete).toBe(true);
    expect(result.permissions.crossContextShare).toBe(true);
  });

  it("org write:false beats user write:true (most-restrictive)", () => {
    const result = resolveInstructions([
      { level: "user", source: "user-prefs", permissions: { write: true } },
      { level: "org", source: "org-policy", permissions: { write: false } },
    ]);
    expect(result.permissions.write).toBe(false);
  });

  it("behavior chunks are ordered base to user", () => {
    const instructions: Instruction[] = [
      { level: "user", source: "user-prefs", text: "summarize in 3 sentences" },
      { level: "org", source: "org-policy", text: "summarize in 5 bullets" },
      { level: "base", source: "system", text: "be concise" },
      { level: "cap-instance", source: "linear-internal", text: "use formal tone for this workspace" },
      { level: "cap-type", source: "linear", text: "include issue IDs" },
    ];
    const result = resolveInstructions(instructions);
    const sources = result.behaviorChunks.map((c) => c.source);
    expect(sources).toEqual(["system", "org-policy", "linear", "linear-internal", "user-prefs"]);
  });

  it("two cap-instance instructions with disagreeing permissions record a conflict", () => {
    const result = resolveInstructions([
      { level: "cap-instance", source: "linear-internal", permissions: { write: true } },
      { level: "cap-instance", source: "linear-customer", permissions: { write: false } },
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].field).toBe("write");
    expect(result.permissions.write).toBe(false);
  });

  it("same-level cap-instances that agree do not produce conflicts", () => {
    const result = resolveInstructions([
      { level: "cap-instance", source: "linear-a", permissions: { write: false } },
      { level: "cap-instance", source: "linear-b", permissions: { write: false } },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("multiple permission fields can all be restricted independently", () => {
    const result = resolveInstructions([
      { level: "org", source: "org", permissions: { delete: false } },
      { level: "cap-type", source: "github", permissions: { crossContextShare: false } },
    ]);
    expect(result.permissions).toEqual({ write: true, delete: false, crossContextShare: false });
  });

  it("instructions with only text and no permissions leave defaults", () => {
    const result = resolveInstructions([
      { level: "org", source: "org", text: "respond in Spanish" },
      { level: "user", source: "user", text: "respond in French" },
    ]);
    expect(result.permissions).toEqual({ write: true, delete: true, crossContextShare: true });
    expect(result.behaviorChunks).toHaveLength(2);
    expect(result.behaviorChunks[0].text).toBe("respond in Spanish");
    expect(result.behaviorChunks[1].text).toBe("respond in French");
  });
});
