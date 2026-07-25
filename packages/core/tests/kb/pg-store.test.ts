/**
 * KnowledgeStore contract tests against real pgvector (halfvec 3072 + HNSW).
 *   TEST_DATABASE_URL=postgres://tino:tino@localhost:5433/tino bun run test
 * Skipped without TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgKnowledgeStore } from "../../src/infrastructure/driven/kb/pg-store.js";
import { ensureKbSchema, KB_EMBED_DIMS } from "../../src/infrastructure/driven/kb/schema.js";
import { createFakeEmbedder, l2Normalize } from "../../src/infrastructure/driven/kb/vertex-embedder.js";
import { createPgPool } from "../../src/infrastructure/driven/persistence/postgres/client.js";
import type { KbChunk } from "../../src/ports/outbound.js";

const DB_URL = process.env.TEST_DATABASE_URL;
const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Basis-ish vector: 1 at position i, normalized. */
const basis = (i: number): number[] => {
  const v = new Array<number>(KB_EMBED_DIMS).fill(0);
  v[i] = 1;
  return v;
};

const chunk = (over: Partial<KbChunk>): KbChunk => ({
  scope: "user",
  userId: "u-test",
  source: "slack_dm",
  sourceRef: "D1:win:1",
  chunkSeq: 0,
  text: "hello world",
  ts: Date.now(),
  ...over,
});

describe.skipIf(!DB_URL)("pg knowledge store (pgvector halfvec)", () => {
  const pool = DB_URL ? createPgPool(DB_URL) : (null as never);
  const store = DB_URL ? createPgKnowledgeStore({ pool }) : (null as never);

  beforeAll(async () => {
    const ok = await ensureKbSchema(pool, noopLogger);
    expect(ok).toBe(true); // pgvector image must support halfvec
    await pool.query("TRUNCATE kb_chunks, kb_cursors, kb_index_state");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("upsert is idempotent by content hash; changed text rewrites", async () => {
    const c = chunk({ sourceRef: "D1:win:idem" });
    expect(await store.upsertChunks([c], [basis(0)])).toBe(1);
    expect(await store.upsertChunks([c], [basis(0)])).toBe(0); // unchanged → skipped
    expect(await store.upsertChunks([{ ...c, text: "hello world v2" }], [basis(0)])).toBe(1);
  });

  it("re-chunk shrink deletes stale seq tails", async () => {
    const refs = [0, 1, 2].map((seq) => chunk({ sourceRef: "C9:thread:100", source: "slack_thread", chunkSeq: seq, text: `part ${seq}` }));
    await store.upsertChunks(refs, [basis(1), basis(2), basis(3)]);
    await store.deleteStaleSeqs("user", "u-test", "slack_thread", "C9:thread:100", 0);
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
        chunk({ scope: "workspace", userId: "", sourceRef: "C1:win:ws", source: "slack_channel", text: "azure billing in channel", ts: now }),
      ],
      [basis(10), basis(10), basis(500), basis(10), basis(10)],
    );

    const hits = await store.search({
      scope: "user",
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
      scope: "user",
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

  it("stats + forgetUser (wipe + tombstone)", async () => {
    const before = await store.stats("user", "u-test");
    expect(before.chunks).toBeGreaterThan(0);

    await store.forgetUser("u-test");
    const after = await store.stats("user", "u-test");
    expect(after.chunks).toBe(0);

    const state = await store.getIndexState("user", "u-test", "slack");
    expect(state?.status).toBe("disabled"); // tombstone blocks auto-reindex
  });

  it("cursors + index state round trip", async () => {
    await store.setCursor("workspace", "", "slack", "C123", { latest: "1753.001", backfillDone: false });
    expect(await store.getCursor("workspace", "", "slack", "C123")).toEqual({ latest: "1753.001", backfillDone: false });
    await store.setCursor("workspace", "", "slack", "C123", { latest: "1754.002", backfillDone: true });
    expect((await store.getCursor("workspace", "", "slack", "C123"))?.latest).toBe("1754.002");

    await store.setIndexState({ scope: "workspace", userId: "", source: "slack", status: "active", backfillDone: true, lastCycleAt: Date.now() });
    const st = await store.getIndexState("workspace", "", "slack");
    expect(st?.backfillDone).toBe(true);
    expect((await store.listIndexStates()).length).toBeGreaterThan(0);
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
