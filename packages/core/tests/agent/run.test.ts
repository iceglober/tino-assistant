import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "../../src/agent/history.js";
import { runAgent } from "../../src/agent/run.js";
import type { DiscoveryResult } from "../../src/discovery/types.js";
import type { ConfigStore } from "../../src/persistence/config.js";

// Mock the `ai` module so generateText never hits the network.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      text: "i can help with Gmail.",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  };
});

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("runAgent — activeCapabilities forwarding", () => {
  it("forwards activeCapabilities to the output validator so legitimate capability mentions are not blocked", async () => {
    const history = createHistoryStore({ cap: 40 });

    // Positive: with gmail active, the Gmail mention should pass the validator.
    const resultAllowed = await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {},
      userId: "U1",
      text: "what can you help with?",
      activeCapabilities: ["gmail"],
    });

    expect(resultAllowed).toBe("i can help with Gmail.");
    expect(resultAllowed).not.toMatch(/flagged by the safety filter/);

    // Negative: with no active capabilities, the same model output should be blocked.
    const history2 = createHistoryStore({ cap: 40 });
    const resultBlocked = await runAgent({
      model: {} as never,
      history: history2,
      logger: stubLogger,
      tools: {},
      userId: "U1",
      text: "what can you help with?",
      activeCapabilities: [],
    });

    expect(resultBlocked).toMatch(/flagged by the safety filter/);
  });
});

describe("runAgent — system prompt wiring", () => {
  it("system prompt passed to generateText only mentions active capability tools", async () => {
    vi.mocked(generateText).mockClear();
    // Override the mock to return a safe response for this test
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "i can help with github.",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const history = createHistoryStore({ cap: 40 });

    await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {
        github_search_code: {
          description: "stub",
          inputSchema: {} as never,
          execute: async () => "",
        } as never,
      },
      userId: "U1",
      text: "what can you help with?",
      activeCapabilities: ["github"],
    });

    const calls = vi.mocked(generateText).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const systemArg = calls[calls.length - 1][0].system as string;

    expect(systemArg).toContain("github_search_code");
    expect(systemArg).not.toContain("gmail_search");
    expect(systemArg).not.toContain("linear_search_issues");
    expect(systemArg).not.toContain("slack_search_messages");
    expect(systemArg).not.toContain("calendar_list_events");
    expect(systemArg).not.toContain("cloudwatch_logs_query");
  });
});

// ── Discovery loading from configStore ──────────────────────────────────────
function makeStubConfigStore(initial: Record<string, string> = {}): ConfigStore {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    getTyped: vi.fn(async <T>(key: string, fallback: T) => {
      const raw = data.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, JSON.stringify(value));
    }),
    list: vi.fn(async () => []),
    delete: vi.fn(async (key: string) => data.delete(key)),
  };
}

const sampleDiscovery: DiscoveryResult = {
  roleSummary: "Engineering manager for the platform team.",
  inferredTitle: "Engineering Manager",
  inferredDepartment: "Platform",
  orgRelationships: [],
  responsibilities: [],
  communicationStyle: { summary: "direct", preferredChannels: ["slack"], patterns: [] },
  workPatterns: {
    meetingLoad: "heavy",
    peakHours: "9-12",
  } as DiscoveryResult["workPatterns"],
  painPoints: [],
  suggestions: [],
  analyzedAt: 1_700_000_000_000,
  dataSourcesUsed: ["gmail", "calendar"],
};

describe("runAgent — discovery loading from configStore", () => {
  it("loads user.${userId}.discovery_result and forwards parsed DiscoveryResult to buildSystemPrompt", async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const configStore = makeStubConfigStore({
      "user.U1.discovery_result": JSON.stringify(sampleDiscovery),
    });
    const history = createHistoryStore({ cap: 40 });

    await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {},
      userId: "U1",
      text: "hello",
      activeCapabilities: ["gmail"],
      configStore,
    });

    // Assert configStore was queried with the right key
    expect(configStore.get).toHaveBeenCalledWith("user.U1.discovery_result");

    // The system prompt passed to generateText should reflect a populated User
    // Profile section — i.e., the parsed DiscoveryResult reached buildSystemPrompt.
    const calls = vi.mocked(generateText).mock.calls;
    const systemArg = calls[calls.length - 1][0].system as string;
    expect(systemArg).toContain("Engineering Manager");
  });

  it("silently ignores malformed discovery JSON (no throw, discovery becomes undefined)", async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const configStore = makeStubConfigStore({
      "user.U1.discovery_result": "{not valid json",
    });
    const history = createHistoryStore({ cap: 40 });

    // Must not throw.
    await expect(
      runAgent({
        model: {} as never,
        history,
        logger: stubLogger,
        tools: {},
        userId: "U1",
        text: "hello",
        activeCapabilities: ["gmail"],
        configStore,
      }),
    ).resolves.toBeDefined();

    // The system prompt should not contain the populated marker.
    const calls = vi.mocked(generateText).mock.calls;
    const systemArg = calls[calls.length - 1][0].system as string;
    expect(systemArg).not.toContain("Engineering Manager");
  });

  it("does not attempt a discovery load when configStore is undefined", async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const history = createHistoryStore({ cap: 40 });

    // No configStore passed at all — the discovery branch must be skipped.
    await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {},
      userId: "U1",
      text: "hello",
      activeCapabilities: ["gmail"],
      // configStore intentionally omitted
    });

    const calls = vi.mocked(generateText).mock.calls;
    const systemArg = calls[calls.length - 1][0].system as string;
    expect(systemArg).not.toContain("Engineering Manager");
  });
});
