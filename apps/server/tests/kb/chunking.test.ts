import {
  chunkEmail,
  estimateTokens,
  rollupThread,
  type SlackKbMessage,
  scoreChunk,
  slackTsToMs,
  windowMessages,
} from "@tino/core/domain/kb";
import { describe, expect, it } from "vitest";
import { stripQuotedReply } from "../../src/infrastructure/driven/tools/google/gmail-body.js";

const DAY = 86_400_000;

const msg = (tsSec: number, author: string, text: string): SlackKbMessage => ({
  ts: `${tsSec}.000100`,
  author,
  text,
});

describe("scoreChunk", () => {
  it("is monotonic in similarity and decays with age", () => {
    expect(scoreChunk(0.9, DAY, 0.3, 30)).toBeGreaterThan(scoreChunk(0.5, DAY, 0.3, 30));
    expect(scoreChunk(0.7, DAY, 0.3, 30)).toBeGreaterThan(scoreChunk(0.7, 60 * DAY, 0.3, 30));
  });

  it("w=0 (explicit date filter) reduces to pure similarity", () => {
    expect(scoreChunk(0.42, 90 * DAY, 0, 30)).toBeCloseTo(0.42, 9);
  });

  it("regression pin: a 2-month-old chunk needs ~+0.26 sim to beat a week-old one (w=0.3, τ=30d)", () => {
    const weekOld = scoreChunk(0.5, 7 * DAY, 0.3, 30);
    expect(scoreChunk(0.75, 60 * DAY, 0.3, 30)).toBeLessThan(weekOld);
    expect(scoreChunk(0.79, 60 * DAY, 0.3, 30)).toBeGreaterThan(weekOld);
  });
});

describe("rollupThread", () => {
  it("small thread → one chunk with header, participants, and last-message ts", () => {
    const messages = [msg(1_753_000_000, "Alice", "kickoff"), msg(1_753_000_600, "Bob", "reply")];
    const chunks = rollupThread({ channelLabel: "#eng-infra", messages });
    expect(chunks).toHaveLength(1);
    const c = chunks[0];
    expect(c?.text.startsWith("#eng-infra — thread,")).toBe(true);
    expect(c?.text).toContain("(Alice, Bob)");
    expect(c?.text).toContain("Alice: kickoff");
    expect(c?.tsMs).toBe(slackTsToMs("1753000600.000100"));
  });

  it("long thread splits at message boundaries with 2-message overlap, ascending seqs", () => {
    const messages = Array.from({ length: 40 }, (_, i) => msg(1_753_000_000 + i * 60, `U${i % 3}`, "x".repeat(300)));
    const chunks = rollupThread({ channelLabel: "#c", messages, maxTokens: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkSeq)).toEqual(chunks.map((_, i) => i));
    // Overlap: the first message line of chunk n+1 appears in chunk n too.
    const linesOf = (t: string): string[] => t.split("\n").slice(1);
    for (let i = 1; i < chunks.length; i++) {
      const firstLine = linesOf((chunks[i] as { text: string }).text)[0] as string;
      expect((chunks[i - 1] as { text: string }).text).toContain(firstLine);
    }
  });

  it("empty thread → no chunks", () => {
    expect(rollupThread({ channelLabel: "#c", messages: [] })).toEqual([]);
  });
});

describe("windowMessages", () => {
  it("flushes on message-count budget and marks only the tail open", () => {
    const messages = Array.from({ length: 60 }, (_, i) => msg(1_753_000_000 + i, "A", "hi"));
    const windows = windowMessages({ channelLabel: "#gen", messages, maxMessages: 25 });
    expect(windows.length).toBe(3); // 25 + 25 + 10-tail
    expect(windows.map((w) => w.closed)).toEqual([true, true, false]);
    expect(windows[0]?.refTs).toBe("1753000000.000100"); // stable ref = first msg ts
  });

  it("flushes on UTC day boundary", () => {
    const day1 = 1_753_000_000; // some time on day X
    const day2 = day1 + 86_400 * 2;
    const windows = windowMessages({ channelLabel: "#gen", messages: [msg(day1, "A", "one"), msg(day2, "B", "two")] });
    expect(windows.length).toBe(2);
    expect(windows[0]?.closed).toBe(true);
    expect(windows[1]?.text).toContain("B: two");
  });

  it("flushes on token budget", () => {
    const messages = [msg(1_753_000_000, "A", "x".repeat(3000)), msg(1_753_000_060, "B", "short")];
    const windows = windowMessages({ channelLabel: "#gen", messages, maxTokens: 500 });
    expect(windows.length).toBe(2);
  });
});

describe("chunkEmail", () => {
  it("short email → single chunk with headers", () => {
    const chunks = chunkEmail({
      subject: "Q3 contract",
      from: "Jane <j@x.io>",
      dateMs: 1_753_000_000_000,
      body: "short body",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("Subject: Q3 contract");
    expect(chunks[0]?.text).toContain("From: Jane <j@x.io>");
    expect(chunks[0]?.tsMs).toBe(1_753_000_000_000);
  });

  it("long email splits at paragraphs; every chunk keeps the header", () => {
    const body = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"y".repeat(200)}`).join("\n\n");
    const chunks = chunkEmail({ subject: "Long", from: "a@b.c", dateMs: 1, body });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.startsWith("Subject: Long")).toBe(true);
    expect(chunks.map((c) => c.chunkSeq)).toEqual(chunks.map((_, i) => i));
    expect(estimateTokens(chunks[0]?.text ?? "")).toBeLessThan(900);
  });
});

describe("stripQuotedReply", () => {
  it("drops >-quoted lines and cuts at 'On … wrote:'", () => {
    const text = [
      "Thanks, sounds good.",
      "",
      "On Jul 20, 2026, at 9:00 AM, Jane Doe <jane@x.io> wrote:",
      "> earlier text",
      "> more",
    ].join("\n");
    expect(stripQuotedReply(text)).toBe("Thanks, sounds good.");
  });

  it("cuts at Original Message separators and forwarded headers", () => {
    expect(stripQuotedReply("Reply here\n-----Original Message-----\nold stuff")).toBe("Reply here");
    expect(stripQuotedReply("New note\nFrom: someone@x.io\nold")).toBe("New note");
  });
});
