import { describe, expect, it } from "vitest";
import { toSlackTs } from "../../src/infrastructure/driven/tools/slack/time.js";

describe("toSlackTs", () => {
  it("passes through epoch-seconds Slack ts values", () => {
    expect(toSlackTs("1753372800")).toBe("1753372800");
    expect(toSlackTs("1753372800.000123")).toBe("1753372800.000123");
  });

  it("converts ISO dates and datetimes to epoch seconds", () => {
    expect(toSlackTs("2026-07-01")).toBe(String(Math.floor(Date.parse("2026-07-01") / 1000)));
    expect(toSlackTs("2026-07-01T12:00:00Z")).toBe(String(Date.parse("2026-07-01T12:00:00Z") / 1000));
  });

  it("returns undefined for absent or unparseable input", () => {
    expect(toSlackTs(undefined)).toBeUndefined();
    expect(toSlackTs("")).toBeUndefined();
    expect(toSlackTs("not-a-date")).toBeUndefined();
  });
});
