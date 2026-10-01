import { describe, expect, it } from "vitest";
import {
  clusterCount,
  factKey,
  keywordLabel,
  kmeans,
  representatives,
  validateDraft,
} from "@tino/core/domain/knowledge";
import type { KbFactDraft } from "@tino/core/ports/outbound";

const draft = (over: Partial<KbFactDraft> = {}): KbFactDraft => ({
  kind: "project",
  subject: "Stedi POC",
  statement: "Austin owns the Stedi proof of concept.",
  confidence: 0.8,
  evidenceIdx: [0],
  ...over,
});

describe("factKey", () => {
  it("collapses re-phrasings of the same claim onto one key", () => {
    const a = factKey("Stedi POC", "Sandbox credentials are blocking the Stedi POC");
    const b = factKey("Stedi POC", "The Stedi POC is blocked on the sandbox credentials");
    expect(a).toBe(b);
  });

  it("keeps genuinely different claims apart", () => {
    const a = factKey("Stedi POC", "Sandbox credentials are blocking the POC");
    const b = factKey("Stedi POC", "The POC kicked off in April with two engineers");
    expect(a).not.toBe(b);
  });

  it("is stable and bounded for long statements", () => {
    const long = factKey("x", "word ".repeat(200));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(factKey("x", "word ".repeat(200))).toBe(long);
  });

  it("never returns an empty key", () => {
    expect(factKey("the a of", "is are was")).toBe("unnamed");
  });
});

describe("validateDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(validateDraft(draft(), 4)).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(validateDraft(draft({ kind: "vibe" as never }), 4)).toBe(false);
  });

  it("rejects evidence pointing outside the batch — the model cannot cite what it was not shown", () => {
    expect(validateDraft(draft({ evidenceIdx: [9] }), 4)).toBe(false);
    expect(validateDraft(draft({ evidenceIdx: [-1] }), 4)).toBe(false);
    expect(validateDraft(draft({ evidenceIdx: [] }), 4)).toBe(false);
  });

  it("rejects empty or runaway text", () => {
    expect(validateDraft(draft({ statement: "short" }), 4)).toBe(false);
    expect(validateDraft(draft({ subject: "  " }), 4)).toBe(false);
    expect(validateDraft(draft({ statement: "x".repeat(401) }), 4)).toBe(false);
  });
});

describe("clusterCount", () => {
  it("grows sublinearly and stays inside bounds", () => {
    expect(clusterCount(0)).toBe(1);
    expect(clusterCount(4)).toBe(2);
    expect(clusterCount(200)).toBe(10);
    expect(clusterCount(100_000)).toBe(18);
  });
});

describe("kmeans", () => {
  // Three tight, well-separated groups in 3-space.
  const corpus = [
    [1, 0, 0],
    [0.98, 0.05, 0],
    [0.95, 0.1, 0.02],
    [0, 1, 0],
    [0.03, 0.99, 0],
    [0, 0.97, 0.05],
    [0, 0, 1],
    [0.02, 0, 0.98],
    [0, 0.04, 0.99],
  ];

  it("recovers separated groups", () => {
    const clusters = kmeans(corpus, 3);
    expect(clusters).toHaveLength(3);
    expect(clusters.map((c) => c.members.length).sort()).toEqual([3, 3, 3]);
    // Members of a cluster all come from the same third of the corpus.
    for (const c of clusters) {
      const thirds = new Set(c.members.map((i) => Math.floor(i / 3)));
      expect(thirds.size).toBe(1);
    }
  });

  it("is deterministic — the same corpus must not reshuffle between cycles", () => {
    const a = kmeans(corpus, 3);
    const b = kmeans(corpus, 3);
    expect(b.map((c) => c.members)).toEqual(a.map((c) => c.members));
  });

  it("never returns more clusters than points, and drops empty ones", () => {
    const clusters = kmeans([[1, 0, 0], [0, 1, 0]], 5);
    expect(clusters.length).toBeLessThanOrEqual(2);
    expect(clusters.every((c) => c.members.length > 0)).toBe(true);
  });

  it("handles an empty corpus", () => {
    expect(kmeans([], 3)).toEqual([]);
  });

  it("orders clusters largest first so the themes list reads by prominence", () => {
    const lopsided = [[1, 0, 0], [0.99, 0.01, 0], [0.98, 0, 0.02], [0.97, 0.02, 0], [0, 1, 0]];
    const clusters = kmeans(lopsided, 2);
    expect(clusters[0]?.members.length).toBeGreaterThanOrEqual(clusters[1]?.members.length ?? 0);
  });
});

describe("keywordLabel", () => {
  it("names a cluster from the terms its excerpts share", () => {
    const { label } = keywordLabel([
      "sandbox credentials are still missing for stedi",
      "stedi sandbox access blocked again",
      "chasing stedi for sandbox credentials",
    ]);
    expect(label.toLowerCase()).toContain("stedi");
    expect(label.toLowerCase()).toContain("sandbox");
  });

  it("ignores slack ids and bare numbers, which are not topics", () => {
    const { label } = keywordLabel([
      "#chan — 2026-04-29 [04-29 22:42] U05S91V7LJF: deployment rollback",
      "[04-29 22:45] U0AG64BLXAB: deployment rollback again",
      "[04-29 22:50] C08MWL9N06S deployment failed",
    ]);
    expect(label.toLowerCase()).toContain("deployment");
    expect(label).not.toMatch(/U05S91V7LJF|C08MWL9N06S|\d{4}/i);
  });

  it("degrades to a placeholder rather than throwing on empty input", () => {
    expect(keywordLabel([]).label).toBe("Unlabelled");
    expect(keywordLabel(["the a of is"]).label).toBe("Unlabelled");
  });

  it("is deterministic", () => {
    const s = ["billing azure spend", "azure billing again", "spend on azure billing"];
    expect(keywordLabel(s)).toEqual(keywordLabel(s));
  });
});

describe("representatives", () => {
  it("returns the members closest to the centre first", () => {
    const vectors = [
      [1, 0, 0],
      [0.9, 0.4, 0],
      [0.6, 0.8, 0],
    ];
    const cluster = { centroid: [1, 0, 0], members: [0, 1, 2] };
    expect(representatives(vectors, cluster, 2)).toEqual([0, 1]);
  });

  it("never returns more than the cluster holds", () => {
    const cluster = { centroid: [1, 0, 0], members: [0] };
    expect(representatives([[1, 0, 0]], cluster, 6)).toHaveLength(1);
  });
});
