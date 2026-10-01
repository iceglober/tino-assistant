/**
 * Gmail ingestion honouring "don't learn from", with Gmail faked at the API
 * boundary and the knowledge store faked at the port.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DontLearnFrom } from "../../src/domain/dont-learn-from.js";

const gmail = {
  users: {
    messages: {
      list: vi.fn(),
      get: vi.fn(),
    },
  },
};
vi.mock("../../src/infrastructure/driven/kb/sources/gmail-exclusions.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/infrastructure/driven/kb/sources/gmail-exclusions.js")>();
  return { ...real, gmailClientFor: vi.fn(async () => gmail) };
});

const { createGmailKbSource } = await import("../../src/infrastructure/driven/kb/sources/gmail.js");

const message = (id: string, labelIds: string[], subject = `subject ${id}`) => ({
  data: {
    id,
    threadId: `t${id}`,
    labelIds,
    internalDate: String(Date.now() - 3600_000),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: subject },
        { name: "From", value: "person@partner.com" },
      ],
      body: { data: Buffer.from(`a real-looking message ${id}`).toString("base64url") },
    },
  },
});

function setup(exclusions: DontLearnFrom) {
  const cursors = new Map<string, Record<string, unknown>>();
  const store = {
    getCursor: vi.fn(async (_s: string, _u: string, _src: string, stream: string) => cursors.get(stream) ?? null),
    setCursor: vi.fn(
      async (_s: string, _u: string, _src: string, stream: string, state: Record<string, unknown>) =>
        void cursors.set(stream, structuredClone(state)),
    ),
    stats: vi.fn(async () => ({ chunks: 10, oldestMs: Date.now() - 200 * 86_400_000, newestMs: Date.now() })),
    upsertChunks: vi.fn(async (chunks: unknown[]) => chunks.length),
    deleteStaleSeqs: vi.fn(async () => {}),
    forgetSourceItems: vi.fn(async (_s: string, _u: string, _src: string, refs: string[]) => ({
      excerptsRemoved: refs.length,
      factsRemoved: 1,
      factsTrimmed: 0,
    })),
  };
  let current = exclusions;
  const source = createGmailKbSource({
    store: store as never,
    embedder: { embedDocuments: vi.fn(async (t: string[]) => t.map(() => [0.1])), embedQuery: vi.fn() },
    config: {} as never,
    userCapabilities: {} as never,
    dontLearnFrom: { get: async () => current, set: async () => {} },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    messageBudget: 10,
  });
  const run = () => source({ scope: "private", userId: "u1", source: "gmail" }, true);
  return { store, run, setExclusions: (e: DontLearnFrom) => void (current = e) };
}

const warmup: DontLearnFrom = {
  gmail: [
    { kind: "gmailLabel", labelId: "Label_W", name: "warmup" },
    { kind: "gmailSearch", query: '"WRM-7Q2"', name: "warmup tag" },
  ],
};

beforeEach(() => {
  gmail.users.messages.list.mockReset();
  gmail.users.messages.get.mockReset();
});

describe("gmail ingestion with exclusions", () => {
  it("keeps excluded searches out of the query and skips excluded labels", async () => {
    const { run, store } = setup(warmup);
    gmail.users.messages.list.mockImplementation(async (args: { q?: string; labelIds?: string[] }) => {
      if (args.labelIds) return { data: { messages: [] } }; // cleanup lookups
      if (args.q?.includes('("WRM-7Q2") after:')) return { data: { messages: [] } };
      if (args.q?.includes("before:")) return { data: { messages: [] } }; // backfill already done
      return { data: { messages: [{ id: "real" }, { id: "warm" }] } };
    });
    gmail.users.messages.get.mockImplementation(async ({ id }: { id: string }) =>
      message(id, id === "warm" ? ["INBOX", "Label_W"] : ["INBOX"]),
    );

    const result = await run();

    const ingestQueries = gmail.users.messages.list.mock.calls
      .map((c) => c[0] as { q?: string; labelIds?: string[] })
      .filter((a) => !a.labelIds && !a.q?.startsWith("("));
    expect(ingestQueries[0]?.q).toContain(' -("WRM-7Q2")');
    const embedded = store.upsertChunks.mock.calls.map((c) => (c[0] as Array<{ sourceRef: string }>)[0]?.sourceRef);
    expect(embedded).toEqual(["real"]);
    expect(result.detail).toContain("1 excluded skipped");
  });

  it("forgets already-learned mail once per change of the list", async () => {
    const { run, store, setExclusions } = setup(warmup);
    gmail.users.messages.list.mockImplementation(async (args: { q?: string; labelIds?: string[] }) => {
      if (args.labelIds?.includes("Label_W"))
        return { data: { messages: [{ id: "old-warm-1" }, { id: "old-warm-2" }] } };
      if (args.q?.startsWith('("WRM-7Q2")'))
        return { data: { messages: [{ id: "old-warm-2" }, { id: "old-tagged" }] } };
      return { data: { messages: [] } };
    });

    const first = await run();
    expect(store.forgetSourceItems).toHaveBeenCalledTimes(1);
    const [, , source, refs] = store.forgetSourceItems.mock.calls[0] as [string, string, string, string[]];
    expect(source).toBe("gmail");
    expect(refs.sort()).toEqual(["old-tagged", "old-warm-1", "old-warm-2"]);
    expect(first.detail).toContain("forgot 3 excluded excerpts and 1 facts");
    // It reaches back to the oldest thing indexed, not just the 90-day horizon.
    const after = Number(/after:(\d+)/.exec((gmail.users.messages.list.mock.calls[0]?.[0] as { q: string }).q)?.[1]);
    expect(after).toBeLessThan(Date.now() / 1000 - 199 * 86_400);

    await run();
    expect(store.forgetSourceItems).toHaveBeenCalledTimes(1); // same list → no repeat

    setExclusions({ gmail: [...warmup.gmail, { kind: "gmailSearch", query: "subject:(test)", name: "tests" }] });
    await run();
    expect(store.forgetSourceItems).toHaveBeenCalledTimes(2); // new list → clean up again
  });

  it("with nothing excluded, it neither looks up nor forgets", async () => {
    const { run, store } = setup({ gmail: [] });
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });
    await run();
    expect(gmail.users.messages.list.mock.calls.every((c) => !(c[0] as { labelIds?: string[] }).labelIds)).toBe(true);
    expect(store.forgetSourceItems).not.toHaveBeenCalled();
  });
});
