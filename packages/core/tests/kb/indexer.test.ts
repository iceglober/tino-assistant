import { describe, expect, it, vi } from "vitest";
import { createKbIndexer, KbAuthError, type KbSourceRunner } from "../../src/application/kb-indexer.js";
import type { KbCycleEvent, KbIndexState, KnowledgeStore, UserCapabilityStore, UserStore } from "../../src/ports/outbound.js";

const noopLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeStore(): KnowledgeStore & {
  states: Map<string, KbIndexState>;
  events: Array<Omit<KbCycleEvent, "id">>;
} {
  const states = new Map<string, KbIndexState>();
  const events: Array<Omit<KbCycleEvent, "id">> = [];
  const key = (s: string, u: string, src: string): string => `${s}:${u}:${src}`;
  return {
    states,
    events,
    upsertChunks: vi.fn(async () => 0),
    listChunks: vi.fn(async () => ({ items: [], total: 0 })),
    statsBySource: vi.fn(async () => []),
    deleteStaleSeqs: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    stats: vi.fn(async () => ({ chunks: 0, oldestMs: null, newestMs: null })),
    forgetUser: vi.fn(async () => {}),
    getCursor: vi.fn(async () => null),
    setCursor: vi.fn(async () => {}),
    getIndexState: vi.fn(async (s, u, src) => states.get(key(s, u, src)) ?? null),
    setIndexState: vi.fn(async (st: KbIndexState) => {
      states.set(key(st.scope, st.userId, st.source), st);
    }),
    listIndexStates: vi.fn(async () => [...states.values()]),
    upsertFacts: vi.fn(async () => ({ created: 0, updated: 0 })),
    listFacts: vi.fn(async () => ({ items: [], total: 0, kinds: [] })),
    searchFacts: vi.fn(async () => []),
    pendingSynthesis: vi.fn(async () => []),
    markSynthesized: vi.fn(async () => {}),
    pendingSynthesisCount: vi.fn(async () => 0),
    replaceTopics: vi.fn(async () => {}),
    listTopics: vi.fn(async () => []),
    chunksForTopic: vi.fn(async () => []),
    embeddingsForClustering: vi.fn(async () => []),
    recordCycleEvents: vi.fn(async (evs: Array<Omit<KbCycleEvent, "id">>) => {
      events.push(...evs);
    }),
    listCycleEvents: vi.fn(async () => []),
  };
}

const usersWith = (ids: string[]): UserStore =>
  ({
    list: vi.fn(async () =>
      ids.map((id) => ({ id, email: `${id}@x.io`, role: "member", status: "active", slackUserId: null, createdAt: 1, updatedAt: 1 })),
    ),
    get: vi.fn(),
    getByEmail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as unknown as UserStore;

const capsFor = (map: Record<string, string[]>): UserCapabilityStore =>
  ({
    list: vi.fn(async (uid: string) => (map[uid] ?? []).map((capabilityId) => ({ capabilityId, enabled: true }))),
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }) as unknown as UserCapabilityStore;

const configWith = (botToken: boolean) =>
  ({
    get: vi.fn(async (k: string) => (k === "slack.botToken" && botToken ? JSON.stringify("xoxb-x") : null)),
    getTyped: vi.fn(async (_k: string, f: unknown) => f),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(async () => []),
  }) as never;

const okRunner = (): KbSourceRunner & ReturnType<typeof vi.fn> =>
  vi.fn(async () => ({ chunksUpserted: 1, apiCalls: 2, backfillDone: true, detail: "2 channels" }));

describe("kb indexer", () => {
  it("discovers principals from bot token + user capabilities and runs each", async () => {
    const store = fakeStore();
    const runners = { slackWorkspace: okRunner(), slackPersonal: okRunner(), gmail: okRunner() };
    const indexer = createKbIndexer({
      store,
      users: usersWith(["u1", "u2"]),
      userCapabilities: capsFor({ u1: ["slack", "gmail"], u2: ["gmail"] }),
      config: configWith(true),
      logger: noopLogger,
      runners,
    });

    await indexer.runCycleOnce();

    expect(runners.slackWorkspace).toHaveBeenCalledTimes(1);
    expect(runners.slackPersonal).toHaveBeenCalledTimes(1); // u1 only
    expect(runners.gmail).toHaveBeenCalledTimes(2); // u1 + u2
    expect(store.states.get("private:u1:slack")?.backfillDone).toBe(true);
    expect(store.states.get("private:u1:slack")?.status).toBe("active");
  });

  it("auth error pauses ONLY that principal and notifies; others continue", async () => {
    const store = fakeStore();
    const failing = vi.fn(async () => {
      throw new KbAuthError("token_revoked");
    });
    const runners = { slackWorkspace: okRunner(), slackPersonal: failing, gmail: okRunner() };
    const notify = vi.fn(async () => {});
    const indexer = createKbIndexer({
      store,
      users: usersWith(["u1"]),
      userCapabilities: capsFor({ u1: ["slack", "gmail"] }),
      config: configWith(true),
      logger: noopLogger,
      runners,
      notifyAuthLoss: notify,
    });

    await indexer.runCycleOnce();
    expect(store.states.get("private:u1:slack")?.status).toBe("paused_auth");
    expect(notify).toHaveBeenCalledWith("u1", "slack");
    expect(runners.gmail).toHaveBeenCalledTimes(1); // isolation: gmail still ran

    // Next cycle: the paused principal is skipped entirely.
    await indexer.runCycleOnce();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("disabled tombstone is never re-run (forget-me consent)", async () => {
    const store = fakeStore();
    store.states.set("private:u1:gmail", {
      scope: "private",
      userId: "u1",
      source: "gmail",
      status: "disabled",
      backfillDone: false,
    });
    const runners = { slackWorkspace: okRunner(), slackPersonal: okRunner(), gmail: okRunner() };
    const indexer = createKbIndexer({
      store,
      users: usersWith(["u1"]),
      userCapabilities: capsFor({ u1: ["gmail"] }),
      config: configWith(false),
      logger: noopLogger,
      runners,
    });

    await indexer.runCycleOnce();
    expect(runners.gmail).not.toHaveBeenCalled();
  });

  it("non-auth errors pause with retry; overlap guard skips concurrent cycles", async () => {
    const store = fakeStore();
    let resolveSlow: () => void = () => {};
    const slow = vi.fn(
      () =>
        new Promise<never>((_res, rej) => {
          resolveSlow = () => rej(new Error("boom"));
        }),
    );
    const runners = { slackWorkspace: slow as never, slackPersonal: okRunner(), gmail: okRunner() };
    const indexer = createKbIndexer({
      store,
      users: usersWith([]),
      userCapabilities: capsFor({}),
      config: configWith(true),
      logger: noopLogger,
      runners,
    });

    const first = indexer.runCycleOnce();
    await new Promise((r) => setTimeout(r, 10));
    await indexer.runCycleOnce(); // overlap-guarded: must not double-run
    expect(slow).toHaveBeenCalledTimes(1);
    resolveSlow();
    await first;
    expect(store.states.get("workspace::slack")?.status).toBe("paused_error");
  });

  it("records one activity row per principal, carrying the runner's detail", async () => {
    const store = fakeStore();
    const runners = { slackWorkspace: okRunner(), slackPersonal: okRunner(), gmail: okRunner() };
    const indexer = createKbIndexer({
      store,
      users: usersWith(["u1"]),
      userCapabilities: capsFor({ u1: ["gmail"] }),
      config: configWith(true),
      logger: noopLogger,
      runners,
    });

    await indexer.runCycleOnce();

    expect(store.events).toHaveLength(2); // workspace slack + u1 gmail
    const ws = store.events.find((e) => e.scope === "workspace");
    expect(ws).toMatchObject({ source: "slack", outcome: "ok", chunksUpserted: 1, apiCalls: 2, detail: "2 channels" });
    expect(store.events.every((e) => e.cycleId === store.events[0]?.cycleId)).toBe(true);
  });

  it("marks a paused principal's activity row as skipped rather than dropping it", async () => {
    const store = fakeStore();
    store.states.set("private:u1:gmail", {
      scope: "private",
      userId: "u1",
      source: "gmail",
      status: "disabled",
      backfillDone: false,
    });
    const indexer = createKbIndexer({
      store,
      users: usersWith(["u1"]),
      userCapabilities: capsFor({ u1: ["gmail"] }),
      config: configWith(false),
      logger: noopLogger,
      runners: { slackWorkspace: okRunner(), slackPersonal: okRunner(), gmail: okRunner() },
    });

    await indexer.runCycleOnce();
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ source: "gmail", outcome: "skipped" });
  });

  it("runs the synthesizer after the sources and logs what it distilled", async () => {
    const store = fakeStore();
    const synthesizer = {
      synthesize: vi.fn(async () => ({
        chunksProcessed: 24,
        factsCreated: 3,
        factsUpdated: 1,
        modelCalls: 1,
        skipped: 0,
      })),
      refreshTopics: vi.fn(async () => ({ topics: 0, modelCalls: 0, refreshed: false })),
    };
    const indexer = createKbIndexer({
      store,
      users: usersWith(["u1"]),
      userCapabilities: capsFor({ u1: ["gmail"] }),
      config: configWith(false),
      logger: noopLogger,
      runners: { slackWorkspace: okRunner(), slackPersonal: okRunner(), gmail: okRunner() },
      synthesizer,
    });

    await indexer.runCycleOnce();

    expect(synthesizer.synthesize).toHaveBeenCalled();
    const synth = store.events.find((e) => e.source === "synthesis");
    expect(synth?.detail).toContain("3 new");
    expect(indexer.status().lastCycle?.factsCreated).toBeGreaterThan(0);
  });

  it("a failing synthesizer does not fail the cycle", async () => {
    const store = fakeStore();
    const indexer = createKbIndexer({
      store,
      users: usersWith([]),
      userCapabilities: capsFor({}),
      config: configWith(true),
      logger: noopLogger,
      runners: { slackWorkspace: okRunner(), slackPersonal: okRunner(), gmail: okRunner() },
      synthesizer: {
        synthesize: vi.fn(async () => {
          throw new Error("model down");
        }),
        refreshTopics: vi.fn(async () => ({ topics: 0, modelCalls: 0, refreshed: false })),
      },
    });

    await indexer.runCycleOnce();

    expect(indexer.status().cyclesCompleted).toBe(1);
    expect(store.events.some((e) => e.source === "synthesis" && e.outcome === "error")).toBe(true);
  });
});
