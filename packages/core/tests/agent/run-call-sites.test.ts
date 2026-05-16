import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("runAgent call sites", () => {
  it("every runAgent call site in src/index.ts passes activeCapabilities", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");

    // Match each `runAgent({ ... })` body, lazily, across newlines.
    const callBlocks = src.match(/runAgent\(\{[\s\S]*?\}\)/g) ?? [];
    expect(callBlocks.length).toBeGreaterThanOrEqual(3);
    for (const block of callBlocks) {
      expect(block).toContain("activeCapabilities");
    }
  });
});
