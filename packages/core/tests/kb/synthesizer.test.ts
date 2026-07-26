import { describe, expect, it, vi } from "vitest";
import { createKbSynthesizer } from "../../src/application/kb-synthesizer.js";
import { KbTruncatedOutputError } from "../../src/domain/knowledge.js";
import type { KbBrowseItem, KbFactDraft, KnowledgeExtractor, KnowledgeStore } from "../../src/ports/outbound.js";

const noopLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const chunk = (id: string, over: Partial<KbBrowseItem> = {}): KbBrowseItem => ({
  id,
  text: "some conversation text for chunk " + id,
  source: "slack_dm",
  sourceRef: "C1:win:" + id,
  chunkSeq: 0,
  ts: 1_700_000_000_000 + Number(id) * 1000,
  permalink: "https://slack.example/" + id,
  meta: {},
  indexedAt: 1_700_000_000_000,
  ...over,
});

function fakeStore(pending: KbBrowseItem[][]): KnowledgeStore & {
  marked: string[];
  upserted: Array<Parameters<KnowledgeStore["upsertFacts"]>[2]>;
} {
  const marked: string[] = [];
  const upserted: Array<Parameters<KnowledgeStore["upsertFacts"]>[2]> = [];
  const queue = [...pending];
  return {
    marked,
    upserted,
    upsertChunks: vi.fn(async () => 0),
    listChunks: vi.fn(async () => ({ items: [], total: 0 })),
    statsBySource: vi.fn(async () => []),
    deleteStaleSeqs: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    stats: vi.fn(async () => ({ chunks: 0, oldestMs: null, newestMs: null })),
    forgetUser: vi.fn(async () => {}),
    getCursor: vi.fn(async () => null),
    setCursor: vi.fn(async () => {}),
    getIndexState: vi.fn(async () => null),
    setIndexState: vi.fn(async () => {}),
    listIndexStates: vi.fn(async () => []),
    upsertFacts: vi.fn(async (_s, _u, facts) => {
      upserted.push(facts);
      return { created: facts.length, updated: 0 };
    }),
    listFacts: vi.fn(async () => ({ items: [], total: 0, kinds: [] })),
    searchFacts: vi.fn(async () => []),
    pendingSynthesis: vi.fn(async () => queue.shift() ?? []),
    markSynthesized: vi.fn(async (ids: string[]) => {
      marked.push(...ids);
    }),
    pendingSynthesisCount: vi.fn(async () => 0),
    replaceTopics: vi.fn(async () => {}),
    listTopics: vi.fn(async () => []),
    chunksForTopic: vi.fn(async () => []),
    embeddingsForClustering: vi.fn(async () => []),
    recordCycleEvents: vi.fn(async () => {}),
    listCycleEvents: vi.fn(async () => []),
  };
}

const fakeEmbedder = {
  embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
};

const config = {
  get: vi.fn(async () => null),
  getTyped: vi.fn(async (k: string, fallback: unknown) => (k === "kb.synthesisBatchesPerCycle" ? 1 : fallback)),
  set: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(async () => []),
} as never;

const extractorReturning = (drafts: KbFactDraft[]): KnowledgeExtractor => ({
  extractFacts: vi.fn(async () => drafts),
  labelTopic: vi.fn(async () => ({ label: "Theme", summary: "s" })),
});

describe("kb synthesizer", () => {
  it("turns drafts into facts with evidence drawn from the cited chunks", async () => {
    const chunks = [chunk("1"), chunk("2"), chunk("3")];
    const store = fakeStore([chunks]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () =>
        extractorReturning([
          {
            kind: "problem",
            subject: "Stedi POC",
            statement: "Sandbox credentials are blocking the integration work.",
            confidence: 0.9,
            evidenceIdx: [0, 2],
          },
        ]),
      config,
      logger: noopLogger,
    });

    const res = await synth.synthesize("private", "u1", "Austin");

    expect(res.factsCreated).toBe(1);
    expect(res.chunksProcessed).toBe(3);
    const fact = store.upserted[0]?.[0];
    expect(fact?.evidence.map((e) => e.chunkId)).toEqual(["1", "3"]);
    expect(fact?.firstSeenMs).toBe(chunks[0]?.ts);
    expect(fact?.lastSeenMs).toBe(chunks[2]?.ts);
    // Every chunk in the batch is consumed, not just the cited ones.
    expect(store.marked).toEqual(["1", "2", "3"]);
  });

  it("drops drafts citing chunks that were never shown to the model", async () => {
    const store = fakeStore([[chunk("1")]]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () =>
        extractorReturning([
          { kind: "fact", subject: "A", statement: "A real enough statement here.", confidence: 0.5, evidenceIdx: [7] },
        ]),
      config,
      logger: noopLogger,
    });

    const res = await synth.synthesize("private", "u1");
    expect(res.factsCreated).toBe(0);
    expect(store.upsertFacts).not.toHaveBeenCalled();
    expect(store.marked).toEqual(["1"]); // still consumed — the batch was read
  });

  it("consumes a batch that yields nothing, so noise cannot wedge the queue", async () => {
    const store = fakeStore([[chunk("1"), chunk("2")]]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => extractorReturning([]),
      config,
      logger: noopLogger,
    });

    await synth.synthesize("private", "u1");
    expect(store.marked).toEqual(["1", "2"]);
  });

  it("halves the batch and retries when the answer overruns the output limit", async () => {
    const chunks = [chunk("1"), chunk("2"), chunk("3"), chunk("4")];
    const store = fakeStore([chunks]);
    let attempt = 0;
    const extractor: KnowledgeExtractor = {
      extractFacts: vi.fn(async (input) => {
        attempt++;
        if (attempt === 1) throw new KbTruncatedOutputError("too long");
        // Second attempt sees half the batch, and cites within it.
        expect(input.chunks).toHaveLength(2);
        return [
          {
            kind: "fact" as const,
            subject: "A",
            statement: "Something durable was said here.",
            confidence: 0.7,
            evidenceIdx: [1],
          },
        ];
      }),
      labelTopic: vi.fn(async () => ({ label: "x", summary: "y" })),
    };

    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => extractor,
      config,
      logger: noopLogger,
    });

    const res = await synth.synthesize("private", "u1");
    expect(res.factsCreated).toBe(1);
    expect(res.modelCalls).toBe(2);
    // Only the chunks actually re-sent are consumed; the rest stay queued.
    expect(store.marked).toEqual(["1", "2"]);
    expect(store.upserted[0]?.[0]?.evidence[0]?.chunkId).toBe("2");
  });

  it("keeps halving until the answer fits, rather than giving up after one retry", async () => {
    const store = fakeStore([[chunk("1"), chunk("2"), chunk("3"), chunk("4"), chunk("5"), chunk("6"), chunk("7"), chunk("8")]]);
    let attempt = 0;
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => ({
        extractFacts: vi.fn(async (input) => {
          attempt++;
          if (input.chunks.length > 2) throw new KbTruncatedOutputError("too long");
          return [];
        }),
        labelTopic: vi.fn(async () => ({ label: "x", summary: "y" })),
      }),
      config,
      logger: noopLogger,
    });

    await synth.synthesize("private", "u1");
    expect(attempt).toBe(3); // 8 → 4 → 2
    expect(store.marked).toEqual(["1", "2"]);
  });

  it("reuses the batch size that worked instead of rediscovering it every cycle", async () => {
    const wide = Array.from({ length: 8 }, (_, i) => chunk(String(i + 1)));
    const store = fakeStore([wide, wide.slice(4), wide.slice(6)]);
    const sizesSeen: number[] = [];
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => ({
        extractFacts: vi.fn(async (input) => {
          sizesSeen.push(input.chunks.length);
          if (input.chunks.length > 2) throw new KbTruncatedOutputError("too long");
          return [];
        }),
        labelTopic: vi.fn(async () => ({ label: "x", summary: "y" })),
      }),
      config,
      logger: noopLogger,
    });

    await synth.synthesize("private", "u1"); // learns 2 the expensive way
    const afterFirst = sizesSeen.length;
    await synth.synthesize("private", "u1");
    // Second run starts near the learned size (2+2=4) rather than back at 8.
    expect(sizesSeen[afterFirst]).toBeLessThanOrEqual(4);
  });

  it("does not retry below the floor — a truncated 2-chunk batch is a real failure", async () => {
    const store = fakeStore([[chunk("1"), chunk("2")]]);
    const extractor: KnowledgeExtractor = {
      extractFacts: vi.fn(async () => {
        throw new KbTruncatedOutputError("still too long");
      }),
      labelTopic: vi.fn(async () => ({ label: "x", summary: "y" })),
    };
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => extractor,
      config,
      logger: noopLogger,
    });

    const res = await synth.synthesize("private", "u1");
    expect(res.errors).toBe(1);
    expect(extractor.extractFacts).toHaveBeenCalledTimes(1);
    expect(store.marked).toEqual([]);
  });

  it("retires bulk mail from the queue without spending a model call on it", async () => {
    const store = fakeStore([
      [
        chunk("1", { source: "gmail", text: "Weekly digest — click here. Unsubscribe at any time." }),
        chunk("2", { source: "gmail", text: "From: no-reply@notifications.example\nYour build finished." }),
        chunk("3", { source: "slack_dm", text: "the stedi sandbox creds finally landed, unblocking us" }),
      ],
    ]);
    const extractor = extractorReturning([]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => extractor,
      config,
      logger: noopLogger,
    });

    await synth.synthesize("private", "u1");

    // All three leave the queue, but only the real conversation reaches the model.
    expect(store.marked.sort()).toEqual(["1", "2", "3"]);
    const seen = (extractor.extractFacts as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(seen.chunks).toHaveLength(1);
    expect(seen.chunks[0].text).toContain("stedi");
  });

  it("does not call the model at all when a batch is entirely bulk mail", async () => {
    const store = fakeStore([
      [chunk("1", { source: "gmail", text: "Newsletter. Unsubscribe." })],
      [],
    ]);
    const extractor = extractorReturning([]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => extractor,
      config,
      logger: noopLogger,
    });

    const res = await synth.synthesize("private", "u1");
    expect(extractor.extractFacts).not.toHaveBeenCalled();
    expect(res.modelCalls).toBe(0);
    expect(store.marked).toEqual(["1"]);
  });

  it("does nothing when no model is configured", async () => {
    const store = fakeStore([[chunk("1")]]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => null,
      config,
      logger: noopLogger,
    });

    const res = await synth.synthesize("private", "u1");
    expect(res.skipped).toBe(1);
    expect(store.pendingSynthesis).not.toHaveBeenCalled();
  });

  it("gives up on a batch that fails repeatedly rather than blocking newer chunks forever", async () => {
    const failing: KnowledgeExtractor = {
      extractFacts: vi.fn(async () => {
        throw new Error("model exploded");
      }),
      labelTopic: vi.fn(async () => ({ label: "x", summary: "y" })),
    };
    const batch = [chunk("1"), chunk("2")];
    const store = fakeStore([batch, batch, batch]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => failing,
      config,
      logger: noopLogger,
    });

    await synth.synthesize("private", "u1");
    await synth.synthesize("private", "u1");
    expect(store.marked).toEqual([]); // first two failures leave it queued

    const third = await synth.synthesize("private", "u1");
    expect(store.marked).toEqual(["1", "2"]); // third gives up and moves on
    expect(third.errors).toBe(1);
    expect(third.lastError).toContain("model exploded");
  });

  it("halts the principal once give-ups pile up, so a broken model cannot eat the backlog", async () => {
    const failing: KnowledgeExtractor = {
      extractFacts: vi.fn(async () => {
        throw new Error("bad request: response_format unsupported");
      }),
      labelTopic: vi.fn(async () => ({ label: "x", summary: "y" })),
    };
    // Distinct batches, so each give-up consumes a different lead chunk.
    const batches = Array.from({ length: 12 }, (_, i) => [chunk(String(i * 2)), chunk(String(i * 2 + 1))]);
    const store = fakeStore(batches);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => failing,
      config,
      logger: noopLogger,
    });

    // Every batch differs, so the per-batch counter keeps resetting — only the
    // consecutive-failure counter can catch this.
    for (let i = 0; i < 6; i++) await synth.synthesize("private", "u1");
    expect(store.marked).toEqual([]); // nothing was consumed on the way down

    const halted = await synth.synthesize("private", "u1");
    expect(halted.lastError).toContain("paused");
    expect(halted.skipped).toBe(1);
    expect(store.marked).toEqual([]); // queue still intact
    expect(failing.extractFacts).toHaveBeenCalledTimes(6); // and the model is left alone
  });

  it("falls back to a keyword label for a cluster the model would not name", async () => {
    const store = fakeStore([[]]);
    store.embeddingsForClustering = vi.fn(async () => [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: "a" + i,
        text: "sandbox credentials for stedi are missing",
        source: "slack_dm" as const,
        embedding: [1, 0.01 * i, 0],
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: "b" + i,
        text: "hiring pipeline candidate interviews",
        source: "slack_dm" as const,
        embedding: [0, 1, 0.01 * i],
      })),
    ]);
    let call = 0;
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => ({
        extractFacts: vi.fn(async () => []),
        labelTopic: vi.fn(async () => {
          call++;
          if (call === 1) return { label: "Stedi Sandbox", summary: "creds" };
          throw new Error("content filtered");
        }),
      }),
      config,
      logger: noopLogger,
    });

    const res = await synth.refreshTopics("private", "u1");
    expect(res.refreshed).toBe(true);
    const written = (store.replaceTopics as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(written).toHaveLength(2); // neither cluster was dropped
    expect(written.map((t: { label: string }) => t.label)).toContain("Stedi Sandbox");
    // The unnamed one still gets something readable from its own vocabulary.
    const fallback = written.find((t: { label: string }) => t.label !== "Stedi Sandbox");
    expect(fallback.label.toLowerCase()).toMatch(/hiring|pipeline|candidate|interview/);
  });

  it("keeps existing themes when every label call fails", async () => {
    const store = fakeStore([[]]);
    store.embeddingsForClustering = vi.fn(async () =>
      Array.from({ length: 10 }, (_, i) => ({ id: "a" + i, text: "alpha", source: "slack_dm" as const, embedding: [1, 0.01 * i, 0] })),
    );
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => ({
        extractFacts: vi.fn(async () => []),
        labelTopic: vi.fn(async () => {
          throw new Error("model down");
        }),
      }),
      config,
      logger: noopLogger,
    });

    const res = await synth.refreshTopics("private", "u1");
    expect(res.refreshed).toBe(false);
    expect(store.replaceTopics).not.toHaveBeenCalled();
  });

  it("skips topic rebuilds inside the refresh window", async () => {
    const store = fakeStore([[]]);
    store.getCursor = vi.fn(async () => ({ at: Date.now() }));
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => extractorReturning([]),
      config,
      logger: noopLogger,
    });

    const res = await synth.refreshTopics("private", "u1");
    expect(res.refreshed).toBe(false);
    expect(store.embeddingsForClustering).not.toHaveBeenCalled();
  });

  it("labels each cluster and replaces the stored themes", async () => {
    const store = fakeStore([[]]);
    store.embeddingsForClustering = vi.fn(async () =>
      [
        ...Array.from({ length: 5 }, (_, i) => ({ id: "a" + i, text: "alpha", source: "slack_dm" as const, embedding: [1, 0.01 * i, 0] })),
        ...Array.from({ length: 5 }, (_, i) => ({ id: "b" + i, text: "beta", source: "slack_dm" as const, embedding: [0, 1, 0.01 * i] })),
      ],
    );
    const extractor = extractorReturning([]);
    const synth = createKbSynthesizer({
      store,
      embedder: fakeEmbedder,
      extractor: () => extractor,
      config,
      logger: noopLogger,
    });

    const res = await synth.refreshTopics("workspace", "");
    expect(res.refreshed).toBe(true);
    expect(res.topics).toBeGreaterThan(0);
    expect(store.replaceTopics).toHaveBeenCalled();
    const written = (store.replaceTopics as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(written[0].chunkIds.length).toBeGreaterThanOrEqual(3);
  });
});
