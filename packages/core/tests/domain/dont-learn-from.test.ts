import { describe, expect, it } from "vitest";
import {
  describeGmailFilter,
  excludedGmailLabelIds,
  exclusionsFingerprint,
  gmailSearchExcluding,
  parseDontLearnFrom,
  searchForGmailFilter,
} from "../../src/domain/dont-learn-from.js";

describe("turning a Gmail filter into a search", () => {
  it("ANDs every criterion, the way the filter does", () => {
    expect(
      searchForGmailFilter({
        from: "warmup@send.example.com OR bot@example.com",
        to: "me@kayn.ai",
        subject: "quick question",
        query: '"WRM-7Q2"',
        negatedQuery: "invoice",
        hasAttachment: true,
        size: 1000,
        sizeComparison: "larger",
      }),
    ).toBe(
      'from:(warmup@send.example.com OR bot@example.com) to:(me@kayn.ai) subject:(quick question) ("WRM-7Q2") -(invoice) has:attachment larger:1000',
    );
  });

  it("has nothing to say for a filter without criteria", () => {
    expect(searchForGmailFilter({})).toBeNull();
    expect(searchForGmailFilter({ from: "  " })).toBeNull();
  });

  it("describes a filter the way Gmail's settings page does", () => {
    expect(describeGmailFilter({ from: "a@b.com", query: "WRM" })).toBe("from: a@b.com · has the words: WRM");
  });
});

describe("applying exclusions", () => {
  const list = {
    gmail: [
      { kind: "gmailLabel" as const, labelId: "Label_7", name: "warmup" },
      { kind: "gmailSearch" as const, query: 'from:(warmup.io) "WRM"', name: "warmup filter" },
      { kind: "gmailSearch" as const, query: "subject:(test send)", name: "tests" },
    ],
  };

  it("searches become negated groups, labels become ids", () => {
    expect(gmailSearchExcluding(list)).toBe(' -(from:(warmup.io) "WRM") -(subject:(test send))');
    expect([...excludedGmailLabelIds(list)]).toEqual(["Label_7"]);
  });

  it("the fingerprint ignores order and names, and changes when what's excluded changes", () => {
    const reordered = { gmail: [...list.gmail].reverse().map((e) => ({ ...e, name: "renamed" })) };
    expect(exclusionsFingerprint(reordered)).toBe(exclusionsFingerprint(list));
    expect(exclusionsFingerprint({ gmail: list.gmail.slice(1) })).not.toBe(exclusionsFingerprint(list));
    expect(exclusionsFingerprint({ gmail: [] })).toBe("");
  });
});

describe("validating input", () => {
  it("accepts labels and searches, trims, and drops duplicates", () => {
    expect(
      parseDontLearnFrom({
        gmail: [
          { kind: "gmailLabel", labelId: "Label_1", name: " warmup " },
          { kind: "gmailLabel", labelId: "Label_1", name: "again" },
          { kind: "gmailSearch", query: "  from:(x.com)  ", fromFilterId: "f1" },
        ],
      }),
    ).toEqual({
      gmail: [
        { kind: "gmailLabel", labelId: "Label_1", name: "warmup" },
        { kind: "gmailSearch", query: "from:(x.com)", name: "from:(x.com)", fromFilterId: "f1" },
      ],
    });
  });

  it.each([
    [{}, "gmail must be a list"],
    [{ gmail: [{ kind: "gmailSearch", query: " " }] }, "a search can't be empty"],
    [{ gmail: [{ kind: "gmailSearch", query: "from:(x" }] }, "unbalanced parentheses"],
    [{ gmail: [{ kind: "gmailSearch", query: "a) OR (b" }] }, "unbalanced parentheses"],
    [{ gmail: [{ kind: "gmailLabel", labelId: "bad id!" }] }, "a Gmail label or a Gmail search"],
    [{ gmail: [{ kind: "slackChannel", id: "C1" }] }, "a Gmail label or a Gmail search"],
    [{ gmail: Array.from({ length: 51 }, (_, i) => ({ kind: "gmailLabel", labelId: `L${i}` })) }, "at most 50"],
  ])("rejects %j", (input, message) => {
    expect(parseDontLearnFrom(input)).toEqual(expect.stringContaining(message));
  });

  it("allows parentheses inside quotes", () => {
    expect(typeof parseDontLearnFrom({ gmail: [{ kind: "gmailSearch", query: '"smile :)"' }] })).toBe("object");
  });
});
