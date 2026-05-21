import { describe, expect, it, vi } from "vitest";
import { DefaultPrivacyFilter, HistoryAppender } from "../../src/agent/history-appender.js";
import type { HistoryStore } from "../../src/agent/history.js";
import type { PrivacyFilter } from "../../src/agent/history-appender.js";
import { SourceRespectingPrivacyFilter } from "../../src/privacy/source-respecting-filter.js";
import type { PrivacyConfig } from "../../src/privacy/types.js";

describe("HistoryAppender", () => {
  it("passes through messages when filter returns all messages", async () => {
    const mockHistory: HistoryStore = {
      get: vi.fn(),
      append: vi.fn(),
      reset: vi.fn(),
    };

    const filter: PrivacyFilter = {
      filter: vi.fn(async (_userId, messages) => messages),
    };

    const appender = new HistoryAppender(mockHistory, filter);
    const userId = "user-123";
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi" },
      { role: "tool" as const, content: "result" },
    ];

    await appender.append(userId, messages);

    expect(filter.filter).toHaveBeenCalledWith(userId, messages);
    expect(mockHistory.append).toHaveBeenCalledWith(userId, messages);
  });

  it("filters messages before appending to history", async () => {
    const mockHistory: HistoryStore = {
      get: vi.fn(),
      append: vi.fn(),
      reset: vi.fn(),
    };

    const filteredMessages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi" },
    ];

    const filter: PrivacyFilter = {
      filter: vi.fn(async () => filteredMessages),
    };

    const appender = new HistoryAppender(mockHistory, filter);
    const userId = "user-123";
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi" },
      { role: "tool" as const, content: "secret-tool-result" },
    ];

    await appender.append(userId, messages);

    expect(filter.filter).toHaveBeenCalledWith(userId, messages);
    expect(mockHistory.append).toHaveBeenCalledWith(userId, filteredMessages);
    expect(mockHistory.append).not.toHaveBeenCalledWith(userId, messages);
  });

  it("DefaultPrivacyFilter returns all messages unchanged", async () => {
    const filter = new DefaultPrivacyFilter();
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi" },
      { role: "tool" as const, content: "result" },
    ];

    const result = await filter.filter("user-123", messages);

    expect(result).toEqual(messages);
    expect(result).toBe(messages);
  });

  it("allows filter to transform messages", async () => {
    const mockHistory: HistoryStore = {
      get: vi.fn(),
      append: vi.fn(),
      reset: vi.fn(),
    };

    const filter: PrivacyFilter = {
      filter: vi.fn(async (_userId, messages) => {
        return messages.map((msg) => {
          if (msg.role === "tool") {
            return { ...msg, content: "[redacted]" };
          }
          return msg;
        });
      }),
    };

    const appender = new HistoryAppender(mockHistory, filter);
    const userId = "user-123";
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "tool" as const, content: "sensitive-data" },
    ];

    await appender.append(userId, messages);

    const appendedMessages = (mockHistory.append as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(appendedMessages[1].content).toBe("[redacted]");
  });
});

describe("SourceRespectingPrivacyFilter — wave 3.5", () => {
  const calendarPrivacyConfig: PrivacyConfig = {
    version: 2,
    calendar: { defaultVisibility: "public", gateAllByDefault: false },
    lastReviewedAt: Date.now(),
  };

  function mockHistory(): HistoryStore {
    return { get: vi.fn(), append: vi.fn(), reset: vi.fn() };
  }

  it("private calendar event persists as placeholder", async () => {
    const filter = new SourceRespectingPrivacyFilter(async () => calendarPrivacyConfig);
    const messages = [
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "tc1", toolName: "calendar_list_events", input: {} }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "tc1",
            toolName: "calendar_list_events",
            output: { events: [{ summary: "Therapy", start: "2026-05-19T14:00:00", visibility: "private" }] },
          },
        ],
      },
    ];

    const history = mockHistory();
    const appender = new HistoryAppender(history, filter);
    await appender.append("user-1", messages as any);

    const persisted = (history.append as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const toolMsg = persisted.find((m: any) => m.role === "tool");
    const part = toolMsg.content[0];
    expect(part.output.type).toBe("redacted");
    expect(part.output.reason).toBe("private_event");
  });

  it("non-private email thread persists with body", async () => {
    const config: PrivacyConfig = {
      version: 2,
      email: { privateFolders: ["Private"], denyListedAddresses: [] },
      lastReviewedAt: Date.now(),
    };
    const filter = new SourceRespectingPrivacyFilter(async () => config);
    const messages = [
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "tc1", toolName: "gmail_search", input: {} }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "tc1",
            toolName: "gmail_search",
            output: { messages: [{ id: "m1", threadId: "t1", from: "alice@co.com", labels: ["Work"] }] },
          },
        ],
      },
    ];

    const history = mockHistory();
    const appender = new HistoryAppender(history, filter);
    await appender.append("user-1", messages as any);

    const persisted = (history.append as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const toolMsg = persisted.find((m: any) => m.role === "tool");
    expect(toolMsg.content[0].output.messages).toBeDefined();
  });

  it("placeholder contains expected metadata fields", async () => {
    const filter = new SourceRespectingPrivacyFilter(async () => calendarPrivacyConfig);
    const messages = [
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "tc1", toolName: "calendar_list_events", input: {} }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "tc1",
            toolName: "calendar_list_events",
            output: { events: [{ summary: "Doctor", start: "2026-05-19T10:00:00", end: "2026-05-19T11:00:00", visibility: "private" }] },
          },
        ],
      },
    ];

    const result = await filter.filter("user-1", messages as any);
    const toolMsg = result.find((m) => m.role === "tool") as any;
    const placeholder = toolMsg.content[0].output;
    expect(placeholder.metadata.startsAt).toBe("2026-05-19T10:00:00");
    expect(placeholder.metadata.endsAt).toBe("2026-05-19T11:00:00");
  });

  it("placeholder reason matches filter decision", async () => {
    const config: PrivacyConfig = {
      version: 2,
      messaging: { denyListedConversationIds: ["D_THERAPIST"], denyListedUserIds: [] },
      lastReviewedAt: Date.now(),
    };
    const filter = new SourceRespectingPrivacyFilter(async () => config);
    const messages = [
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "tc1", toolName: "slack_read_dm", input: { channel: "D_THERAPIST" } }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "tc1",
            toolName: "slack_read_dm",
            output: { messages: [{ user: "U_OTHER", ts: "123" }] },
          },
        ],
      },
    ];

    const result = await filter.filter("user-1", messages as any);
    const toolMsg = result.find((m) => m.role === "tool") as any;
    expect(toolMsg.content[0].output.reason).toBe("deny_listed_dm");
  });

  it("feature flag off restores wave-2 default-allow behavior", async () => {
    const config: PrivacyConfig = {
      version: 2,
      calendar: { defaultVisibility: "public", gateAllByDefault: false },
      lastReviewedAt: Date.now(),
    };
    const filter = new SourceRespectingPrivacyFilter(async () => config, false);
    const messages = [
      {
        role: "assistant" as const,
        content: [{ type: "tool-call" as const, toolCallId: "tc1", toolName: "calendar_list_events", input: {} }],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "tc1",
            toolName: "calendar_list_events",
            output: { events: [{ summary: "Therapy", visibility: "private" }] },
          },
        ],
      },
    ];

    const result = await filter.filter("user-1", messages as any);
    const toolMsg = result.find((m) => m.role === "tool") as any;
    expect(toolMsg.content[0].output.events).toBeDefined();
  });
});
