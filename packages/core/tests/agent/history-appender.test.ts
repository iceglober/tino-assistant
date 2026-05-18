import { describe, expect, it, vi } from "vitest";
import { DefaultPrivacyFilter, HistoryAppender } from "../../src/agent/history-appender.js";
import type { HistoryStore } from "../../src/agent/history.js";
import type { PrivacyFilter } from "../../src/agent/history-appender.js";

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
