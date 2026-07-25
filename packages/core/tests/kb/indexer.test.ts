import { describe, expect, it, vi } from "vitest";
import { createKbIndexer, KbAuthError, type KbSourceRunner } from "../../src/application/kb-indexer.js";
import type { KbIndexState, KnowledgeStore, UserCapabilityStore, UserStore } from "../../src/ports/outbound.js";

const noopLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeStore(): KnowledgeStore & { states: Map<string, KbIndexState> } {
  const states = new Map<string, KbIndexState>();
  const key = (s: string, u: string, src: string): string => `${s}:${u}:${src}`;
  return {
    states,
    upsertChunks: vi.fn(async () => 0),
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
  vi.fn(async () => ({ chunksUpserted: 1, apiCalls: 2, backfillDone: true }));

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
    expect(store.states.get("user:u1:slack")?.backfillDone).toBe(true);
    expect(store.states.get("user:u1:slack")?.status).toBe("active");
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
    expect(store.states.get("user:u1:slack")?.status).toBe("paused_auth");
    expect(notify).toHaveBeenCalledWith("u1", "slack");
    expect(runners.gmail).toHaveBeenCalledTimes(1); // isolation: gmail still ran

    // Next cycle: the paused principal is skipped entirely.
    await indexer.runCycleOnce();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("disabled tombstone is never re-run (forget-me consent)", async () => {
    const store = fakeStore();
    store.states.set("user:u1:gmail", {
      scope: "user",
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
});
