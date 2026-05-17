import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "../../src/agent/history.js";
import { runAgent } from "../../src/agent/run.js";

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
