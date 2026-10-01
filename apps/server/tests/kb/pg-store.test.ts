/**
 * KnowledgeStore contract tests against pgvector (halfvec 3072 + HNSW), on an
 * in-memory PGlite. The store is bound to one org; the last block checks that
 * a second org's store sees none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgKnowledgeStore, KB_CLUSTER_DIMS } from "../../src/infrastructure/driven/kb/pg-store.js";
import { KB_EMBED_DIMS } from "../../src/infrastructure/driven/kb/schema.js";
import { createFakeEmbedder, l2Normalize } from "../../src/infrastructure/driven/kb/embedders.js";
import type { KbChunk, KbEvidence, KbFact, KnowledgeStore } from "@tino/core/ports/outbound";

import type { PgPool } from "../../src/infrastructure/driven/persistence/db.js";
import { testDb } from "../_db.js";

let pool: PgPool;
let store: KnowledgeStore;
let otherOrgStore: KnowledgeStore;

beforeAll(async () => {
  const db = await testDb();
  pool = db.pool;
  const [org, other] = [await db.makeOrg("kb-org"), await db.makeOrg("kb-other")];
  store = createPgKnowledgeStore({ pool, orgId: org.id, embedModel: "fake@3072" });
  otherOrgStore = createPgKnowledgeStore({ pool, orgId: other.id, embedModel: "fake@3072" });
});

afterAll(async () => {
  await pool?.end();
});

/** Basis-ish vector: 1 at position i, normalized. */
const basis = (i: number): number[] => {
  const v = new Array<number>(KB_EMBED_DIMS).fill(0);
  v[i] = 1;
  return v;
};

const chunk = (over: Partial<KbChunk>): KbChunk => ({
  scope: "private",
  userId: "u-test",
  source: "slack_dm",
  sourceRef: "D1:win:1",
  chunkSeq: 0,
  text: "hello world",
  ts: Date.now(),
  ...over,
});

const evidence = (chunkId: string, ts: number): KbEvidence => ({
  chunkId,
  source: "slack_dm",
  ts,
  permalink: "https://slack.example/" + chunkId,
  snippet: "snippet " + chunkId,
});

const fact = (over: Partial<Omit<KbFact, "id" | "updatedAt" | "scope" | "userId">> = {}) => ({
  kind: "project" as const,
  subject: "Stedi POC",
  statement: "Austin owns the Stedi proof of concept.",
  key: "austin-own-poc-proof-stedi",
  confidence: 0.8,
  firstSeenMs: Date.now() - 86_400_000,
  lastSeenMs: Date.now() - 86_400_000,
  evidence: [evidence("1", Date.now() - 86_400_000)],
  ...over,
});

describe("pg knowledge store (pgvector halfvec)", () => {
  it("upsert is idempotent by content hash; changed text rewrites", async () => {
    const c = chunk({ sourceRef: "D1:win:idem" });
    expect(await store.upsertChunks([c], [basis(0)])).toBe(1);
    expect(await store.upsertChunks([c], [basis(0)])).toBe(0); // unchanged → skipped
    expect(await store.upsertChunks([{ ...c, text: "hello world v2" }], [basis(0)])).toBe(1);
  });

  it("re-chunk shrink deletes stale seq tails", async () => {
    const refs = [0, 1, 2].map((seq) =>
      chunk({ sourceRef: "C9:thread:100", source: "slack_thread", chunkSeq: seq, text: "part " + seq }),
    );
    await store.upsertChunks(refs, [basis(1), basis(2), basis(3)]);
    await store.deleteStaleSeqs("private", "u-test", "slack_thread", "C9:thread:100", 0);
    const res = await pool.query("SELECT count(*) FROM kb_chunks WHERE source_ref='C9:thread:100'");
    expect(Number(res.rows[0].count)).toBe(1);
  });

  it("search: scope/user isolation + similarity ordering + recency blend", async () => {
    const now = Date.now();
    const old = now - 60 * 86400_000; // 60 days ago
    await store.upsertChunks(
      [
        chunk({ sourceRef: "D2:win:recent", text: "azure billing discussion", ts: now - 86400_000 }),
        chunk({ sourceRef: "D2:win:old", text: "azure billing discussion (old)", ts: old }),
        chunk({ sourceRef: "D2:win:other", text: "lunch plans", ts: now }),
        chunk({ userId: "u-OTHER", sourceRef: "D3:win:leak", text: "azure billing secret", ts: now }),
        chunk({
          scope: "workspace",
          userId: "",
          sourceRef: "C1:win:ws",
          source: "slack_channel",
          text: "azure billing in channel",
          ts: now,
        }),
      ],
      [basis(10), basis(10), basis(500), basis(10), basis(10)],
    );

    const hits = await store.search({
      scope: "private",
      userId: "u-test",
      embedding: basis(10),
      topK: 10,
      recencyWeight: 0.3,
      recencyTauDays: 30,
    });

    const refsFound = hits.map((h) => h.text);
    expect(refsFound).not.toContain("azure billing secret"); // other user's row never leaks
    expect(refsFound).not.toContain("azure billing in channel"); // workspace scope excluded
    // Same similarity → recency decides: recent chunk outranks the 60-day-old one.
    const iRecent = hits.findIndex((h) => h.text === "azure billing discussion");
    const iOld = hits.findIndex((h) => h.text === "azure billing discussion (old)");
    expect(iRecent).toBeGreaterThanOrEqual(0);
    expect(iOld).toBeGreaterThanOrEqual(0);
    expect(iRecent).toBeLessThan(iOld);
    // And similarity still dominates over topically-unrelated recent content.
    expect(hits[0]?.text).not.toBe("lunch plans");
  });

  it("search with after filter disables recency weighting (w=0) and applies the filter", async () => {
    const hits = await store.search({
      scope: "private",
      userId: "u-test",
      embedding: basis(10),
      topK: 10,
      afterMs: Date.now() - 7 * 86400_000,
      recencyWeight: 0.3,
      recencyTauDays: 30,
    });
    expect(hits.every((h) => h.ts >= Date.now() - 7 * 86400_000)).toBe(true);
    for (const h of hits) expect(h.score).toBeCloseTo(h.sim, 6); // w=0 → score == sim
  });

  it("cursors + index state round trip", async () => {
    await store.setCursor("workspace", "", "slack", "C123", { latest: "1753.001", backfillDone: false });
    expect(await store.getCursor("workspace", "", "slack", "C123")).toEqual({
      latest: "1753.001",
      backfillDone: false,
    });
    await store.setCursor("workspace", "", "slack", "C123", { latest: "1754.002", backfillDone: true });
    expect((await store.getCursor("workspace", "", "slack", "C123"))?.latest).toBe("1754.002");

    await store.setIndexState({
      scope: "workspace",
      userId: "",
      source: "slack",
      status: "active",
      backfillDone: true,
      lastCycleAt: Date.now(),
    });
    const st = await store.getIndexState("workspace", "", "slack");
    expect(st?.backfillDone).toBe(true);
    expect((await store.listIndexStates()).length).toBeGreaterThan(0);
  });

  // ── Synthesis queue ────────────────────────────────────────────────────────

  it("pending queue drains on mark, and rewritten content re-enters it", async () => {
    const c = chunk({ sourceRef: "D4:win:pending", text: "pending one" });
    await store.upsertChunks([c], [basis(20)]);

    const before = await store.pendingSynthesis("private", "u-test", 100);
    const target = before.find((x) => x.text === "pending one");
    expect(target).toBeDefined();

    await store.markSynthesized([target?.id as string]);
    const after = await store.pendingSynthesis("private", "u-test", 100);
    expect(after.find((x) => x.text === "pending one")).toBeUndefined();

    // Content moved → whatever was distilled from it is stale, so it requeues.
    await store.upsertChunks([{ ...c, text: "pending one, revised" }], [basis(20)]);
    const requeued = await store.pendingSynthesis("private", "u-test", 100);
    expect(requeued.find((x) => x.text === "pending one, revised")).toBeDefined();
  });

  it("pending count tracks the queue", async () => {
    const n = await store.pendingSynthesisCount("private", "u-test");
    const listed = await store.pendingSynthesis("private", "u-test", 1000);
    expect(n).toBe(listed.length);
  });

  // ── Facts ──────────────────────────────────────────────────────────────────

  it("re-observing a fact extends it: evidence merges, window widens, no duplicate row", async () => {
    const t1 = Date.parse("2026-05-01T00:00:00Z");
    const t2 = Date.parse("2026-07-01T00:00:00Z");

    const first = await store.upsertFacts(
      "private",
      "u-test",
      [fact({ firstSeenMs: t1, lastSeenMs: t1, evidence: [evidence("1", t1)] })],
      [basis(30)],
    );
    expect(first).toEqual({ created: 1, updated: 0 });

    const second = await store.upsertFacts(
      "private",
      "u-test",
      [
        fact({
          firstSeenMs: t2,
          lastSeenMs: t2,
          statement: "Austin owns the Stedi proof of concept (still).",
          evidence: [evidence("2", t2)],
        }),
      ],
      [basis(30)],
    );
    expect(second).toEqual({ created: 0, updated: 1 });

    const { items, total } = await store.listFacts("private", "u-test", { limit: 10, offset: 0 });
    expect(total).toBe(1);
    const stored = items[0] as KbFact;
    expect(stored.firstSeenMs).toBe(t1); // widened backwards
    expect(stored.lastSeenMs).toBe(t2); // and forwards
    expect(stored.evidence.map((e) => e.chunkId).sort()).toEqual(["1", "2"]);
    expect(stored.statement).toContain("still"); // newest phrasing wins
  });

  it("evidence is deduped by chunk and capped", async () => {
    const t = Date.now();
    for (let i = 0; i < 12; i++) {
      await store.upsertFacts(
        "private",
        "u-test",
        [fact({ key: "cap-test", evidence: [evidence("dup", t), evidence("e" + i, t + i)] })],
        [basis(31)],
      );
    }
    const { items } = await store.listFacts("private", "u-test", { limit: 50, offset: 0, subject: "Stedi POC" });
    const capped = items.find((f) => f.key === "cap-test") as KbFact;
    expect(capped.evidence.length).toBeLessThanOrEqual(8);
    expect(capped.evidence.filter((e) => e.chunkId === "dup").length).toBeLessThanOrEqual(1);
  });

  it("facts are scoped: another user's facts and the workspace's never appear", async () => {
    await store.upsertFacts("private", "u-OTHER", [fact({ key: "other-secret" })], [basis(30)]);
    await store.upsertFacts("workspace", "", [fact({ key: "ws-fact" })], [basis(30)]);

    const mine = await store.listFacts("private", "u-test", { limit: 100, offset: 0 });
    expect(mine.items.map((f) => f.key)).not.toContain("other-secret");
    expect(mine.items.map((f) => f.key)).not.toContain("ws-fact");

    const found = await store.searchFacts({ scope: "private", userId: "u-test", embedding: basis(30), topK: 20 });
    expect(found.map((f) => f.key)).not.toContain("other-secret");
  });

  it("listFacts reports per-kind counts and filters by kind", async () => {
    await store.upsertFacts(
      "private",
      "u-test",
      [fact({ kind: "problem", key: "a-problem", statement: "Sandbox credentials are missing." })],
      [basis(32)],
    );
    const all = await store.listFacts("private", "u-test", { limit: 100, offset: 0 });
    expect(all.kinds.find((k) => k.kind === "problem")?.count).toBeGreaterThan(0);

    const problems = await store.listFacts("private", "u-test", { limit: 100, offset: 0, kind: "problem" });
    expect(problems.items.every((f) => f.kind === "problem")).toBe(true);
  });

  // ── Topics ─────────────────────────────────────────────────────────────────

  it("replaceTopics assigns chunks and swaps cleanly on rebuild", async () => {
    const ids = (await store.pendingSynthesis("private", "u-test", 3)).map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);

    await store.replaceTopics("private", "u-test", [
      { label: "Billing", summary: "money things", chunkIds: ids },
    ]);
    let topics = await store.listTopics("private", "u-test");
    expect(topics).toHaveLength(1);
    expect(topics[0]?.chunks).toBe(ids.length);
    expect((await store.chunksForTopic("private", "u-test", topics[0]?.id as string, 10)).length).toBe(ids.length);

    // Rebuild: old rows go, and the FK clears the stale assignment rather than
    // erroring or orphaning the chunks.
    await store.replaceTopics("private", "u-test", [{ label: "Hiring", summary: "people", chunkIds: [] }]);
    topics = await store.listTopics("private", "u-test");
    expect(topics).toHaveLength(1);
    expect(topics[0]?.label).toBe("Hiring");
    const orphans = await pool.query("SELECT count(*) FROM kb_chunks WHERE id = ANY($1::bigint[])", [ids]);
    expect(Number(orphans.rows[0].count)).toBe(ids.length); // chunks survived
  });

  it("clustering vectors come back truncated to the cluster dimensionality", async () => {
    const rows = await store.embeddingsForClustering("private", "u-test", 5);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.embedding).toHaveLength(KB_CLUSTER_DIMS);
    expect(rows[0]?.embedding.every((n) => Number.isFinite(n))).toBe(true);
  });

  // ── Activity ───────────────────────────────────────────────────────────────

  it("cycle events round trip; a user sees workspace rows and their own only", async () => {
    const at = Date.now();
    await store.recordCycleEvents([
      { cycleId: "c1", at, scope: "workspace", userId: "", source: "slack", outcome: "ok", chunksUpserted: 4, apiCalls: 3, ms: 120, detail: "2 channels" },
      { cycleId: "c1", at, scope: "private", userId: "u-test", source: "gmail", outcome: "ok", chunksUpserted: 9, apiCalls: 5, ms: 300 },
      { cycleId: "c1", at, scope: "private", userId: "u-OTHER", source: "gmail", outcome: "error", chunksUpserted: 0, apiCalls: 0, ms: 5, error: "nope" },
    ]);

    const seen = await store.listCycleEvents("u-test", 50);
    const users = new Set(seen.map((e) => e.userId));
    expect(users.has("u-OTHER")).toBe(false);
    expect(seen.find((e) => e.scope === "workspace")?.detail).toBe("2 channels");
    expect(seen.find((e) => e.source === "gmail")?.chunksUpserted).toBe(9);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  it("forgetUser wipes chunks, facts and topics, and tombstones the principal", async () => {
    expect((await store.stats("private", "u-test")).chunks).toBeGreaterThan(0);
    expect((await store.listFacts("private", "u-test", { limit: 1, offset: 0 })).total).toBeGreaterThan(0);

    await store.forgetUser("u-test");

    expect((await store.stats("private", "u-test")).chunks).toBe(0);
    expect((await store.listFacts("private", "u-test", { limit: 1, offset: 0 })).total).toBe(0);
    expect(await store.listTopics("private", "u-test")).toHaveLength(0);
    expect((await store.getIndexState("private", "u-test", "slack"))?.status).toBe("disabled");

    // Other principals are untouched.
    expect((await store.listFacts("workspace", "", { limit: 1, offset: 0 })).total).toBeGreaterThan(0);
  });

  it("fake embedder is deterministic + normalized (used by unit tests/dev)", async () => {
    const emb = createFakeEmbedder(64);
    const [a1] = await emb.embedDocuments(["azure billing problem"]);
    const a2 = await emb.embedQuery("azure billing problem");
    expect(a1).toEqual(a2);
    const norm = Math.sqrt((a1 as number[]).reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
  });
});

describe("forgetting specific source items", () => {
  const user = `u-forget-${Date.now()}`;
  const other = `${user}-other`;

  it("removes the items' excerpts and the facts resting only on them; trims the rest", async () => {
    const day = 86_400_000;
    const t0 = Date.now() - 10 * day;
    const mail = (ref: string, ts: number, userId = user): KbChunk =>
      chunk({ userId, source: "gmail", sourceRef: ref, text: `email ${ref} ${userId}`, ts });
    await store.upsertChunks(
      [mail("warm-1", t0), mail("warm-2", t0 + day), mail("real-1", t0 + 2 * day), mail("warm-1", t0, other)],
      [basis(1), basis(2), basis(3), basis(4)].map(l2Normalize),
    );
    const ids = Object.fromEntries(
      (await store.listChunks("private", user, { limit: 10, offset: 0, source: "gmail" })).items.map((c) => [c.sourceRef, c.id]),
    ) as Record<string, string>;

    await store.upsertFacts(
      "private",
      user,
      [
        fact({ key: "only-warmup", statement: "Only warmup says so.", evidence: [evidence(ids["warm-1"] as string, t0), evidence(ids["warm-2"] as string, t0 + day)] }),
        fact({ key: "mixed", statement: "Real and warmup both say so.", evidence: [evidence(ids["warm-1"] as string, t0), evidence(ids["real-1"] as string, t0 + 2 * day)] }),
        fact({ key: "untouched", statement: "Only real mail says so.", evidence: [evidence(ids["real-1"] as string, t0 + 2 * day)] }),
      ],
      [basis(10), basis(11), basis(12)].map(l2Normalize),
    );

    const result = await store.forgetSourceItems("private", user, "gmail", ["warm-1", "warm-2", "never-indexed"]);
    expect(result).toEqual({ excerptsRemoved: 2, factsRemoved: 1, factsTrimmed: 1 });

    const left = (await store.listChunks("private", user, { limit: 10, offset: 0, source: "gmail" })).items.map((c) => c.sourceRef);
    expect(left).toEqual(["real-1"]);
    const facts = (await store.listFacts("private", user, { limit: 10, offset: 0 })).items;
    expect(facts.map((f) => f.key).sort()).toEqual(["mixed", "untouched"]);
    const mixed = facts.find((f) => f.key === "mixed");
    expect(mixed?.evidence.map((e) => e.chunkId)).toEqual([ids["real-1"]]);
    // Its dates now come from what's left.
    expect(Math.abs((mixed?.firstSeenMs ?? 0) - (t0 + 2 * day))).toBeLessThan(1000);

    // Someone else's copy of the same message id is untouched.
    expect((await store.listChunks("private", other, { limit: 10, offset: 0 })).total).toBe(1);
  });

  it("does nothing for an empty list or unknown ids", async () => {
    expect(await store.forgetSourceItems("private", user, "gmail", [])).toEqual({ excerptsRemoved: 0, factsRemoved: 0, factsTrimmed: 0 });
    expect(await store.forgetSourceItems("private", user, "gmail", ["nope"])).toEqual({ excerptsRemoved: 0, factsRemoved: 0, factsTrimmed: 0 });
  });
});

describe("isolation between orgs", () => {
  it("another org's store finds, counts, distills and forgets none of this org's knowledge", async () => {
    const ws = chunk({ scope: "workspace", userId: "", source: "slack_channel", sourceRef: "C1:iso", text: "acme only" });
    await store.upsertChunks([ws], [basis(42)]);
    await store.upsertFacts("workspace", "", [fact({ key: "iso-fact" })], [basis(42)]);
    await store.setIndexState({ scope: "workspace", userId: "", source: "slack", status: "active", backfillDone: true });

    const hits = await otherOrgStore.search({
      scope: "workspace",
      userId: "",
      embedding: basis(42),
      topK: 10,
      recencyWeight: 0,
      recencyTauDays: 30,
    });
    expect(hits).toEqual([]);
    expect((await otherOrgStore.stats("workspace", "")).chunks).toBe(0);
    expect((await otherOrgStore.listFacts("workspace", "", { limit: 10, offset: 0 })).total).toBe(0);
    expect(await otherOrgStore.searchFacts({ scope: "workspace", userId: "", embedding: basis(42), topK: 5 })).toEqual([]);
    expect(await otherOrgStore.pendingSynthesis("workspace", "", 10)).toEqual([]);
    expect(await otherOrgStore.listIndexStates()).toEqual([]);

    // Same source ref in the other org is a different row, not an overwrite.
    expect(await otherOrgStore.upsertChunks([{ ...ws, text: "globex only" }], [basis(42)])).toBe(1);
    const mine = await store.listChunks("workspace", "", { limit: 50, offset: 0 });
    expect(mine.items.map((i) => i.text)).toContain("acme only");
    expect(mine.items.map((i) => i.text)).not.toContain("globex only");

    // Marking another org's chunk ids does nothing here.
    const pending = await store.pendingSynthesis("workspace", "", 50);
    await otherOrgStore.markSynthesized(pending.map((p) => p.id));
    expect(await store.pendingSynthesisCount("workspace", "")).toBe(pending.length);
  });
});
