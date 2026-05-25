/**
 * Tests for SlackDiscoveryPort — the Slack data source for discovery.
 *
 * Mocks @slack/bolt WebClient to verify:
 * - getTopDMPartners returns sorted partner list with message counts
 * - getActiveChannels returns sorted channel list with message counts
 * - getMessageSample returns shaped message objects
 * - All methods return [] when no credentials are available
 * - All methods return [] and log a warning when the Slack API throws
 */

import { describe, expect, it, vi } from "vitest";
import { createSlackDiscoveryPort } from "../../src/discovery/slack-port.js";
import type { AppLogger } from "../../src/slack/app.js";
import type { SlackCreds } from "../../src/privacy/adapters/credentials.js";

// ---------------------------------------------------------------------------
// Mock @slack/bolt
// ---------------------------------------------------------------------------

const mockConversationsList = vi.fn();
const mockConversationsHistory = vi.fn();
const mockUsersInfo = vi.fn();
const mockUsersConversations = vi.fn();
const mockSearchMessages = vi.fn();

vi.mock("@slack/bolt", () => ({
  webApi: {
    WebClient: class FakeWebClient {
      conversations = {
        list: mockConversationsList,
        history: mockConversationsHistory,
      };
      users = {
        info: mockUsersInfo,
        conversations: mockUsersConversations,
      };
      search = {
        messages: mockSearchMessages,
      };
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeResolveCreds(token: string | null): (userId: string) => Promise<SlackCreds | null> {
  return async () => (token ? { userToken: token } : null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SlackDiscoveryPort.getTopDMPartners", () => {
  it("returns [] when no credentials", async () => {
    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds(null), logger: makeLogger() });
    const result = await port.getTopDMPartners("user1");
    expect(result).toEqual([]);
  });

  it("returns sorted DM partners with message counts", async () => {
    mockConversationsList.mockResolvedValueOnce({
      channels: [
        { id: "D001", user: "U001" },
        { id: "D002", user: "U002" },
      ],
      response_metadata: { next_cursor: "" },
    });

    mockUsersInfo
      .mockResolvedValueOnce({ user: { real_name: "Alice Chen" } })
      .mockResolvedValueOnce({ user: { real_name: "Bob Smith" } });

    mockConversationsHistory
      .mockResolvedValueOnce({ messages: new Array(10).fill({ text: "hi" }) })  // D001: 10 messages
      .mockResolvedValueOnce({ messages: new Array(5).fill({ text: "hey" }) }); // D002: 5 messages

    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger: makeLogger() });
    const result = await port.getTopDMPartners("user1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "Alice Chen", messageCount: 10 });
    expect(result[1]).toEqual({ name: "Bob Smith", messageCount: 5 });
  });

  it("excludes DMs with zero messages", async () => {
    mockConversationsList.mockResolvedValueOnce({
      channels: [{ id: "D001", user: "U001" }],
      response_metadata: { next_cursor: "" },
    });
    mockUsersInfo.mockResolvedValueOnce({ user: { real_name: "Alice" } });
    mockConversationsHistory.mockResolvedValueOnce({ messages: [] });

    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger: makeLogger() });
    const result = await port.getTopDMPartners("user1");

    expect(result).toEqual([]);
  });

  it("returns [] and logs warning when API throws", async () => {
    mockConversationsList.mockRejectedValueOnce(new Error("network error"));

    const logger = makeLogger();
    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger });
    const result = await port.getTopDMPartners("user1");

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("SlackDiscoveryPort.getActiveChannels", () => {
  it("returns [] when no credentials", async () => {
    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds(null), logger: makeLogger() });
    const result = await port.getActiveChannels("user1");
    expect(result).toEqual([]);
  });

  it("returns sorted channels with message counts", async () => {
    mockUsersConversations.mockResolvedValueOnce({
      channels: [
        { id: "C001", name: "engineering" },
        { id: "C002", name: "general" },
      ],
      response_metadata: { next_cursor: "" },
    });

    mockConversationsHistory
      .mockResolvedValueOnce({ messages: new Array(15).fill({ text: "msg" }) }) // C001: 15
      .mockResolvedValueOnce({ messages: new Array(8).fill({ text: "msg" }) });  // C002: 8

    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger: makeLogger() });
    const result = await port.getActiveChannels("user1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "#engineering", messageCount: 15 });
    expect(result[1]).toEqual({ name: "#general", messageCount: 8 });
  });

  it("returns [] and logs warning when API throws", async () => {
    mockUsersConversations.mockRejectedValueOnce(new Error("api error"));

    const logger = makeLogger();
    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger });
    const result = await port.getActiveChannels("user1");

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("SlackDiscoveryPort.getMessageSample", () => {
  it("returns [] when no credentials", async () => {
    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds(null), logger: makeLogger() });
    const result = await port.getMessageSample("user1");
    expect(result).toEqual([]);
  });

  it("returns shaped message objects from search results", async () => {
    mockSearchMessages.mockResolvedValueOnce({
      messages: {
        matches: [
          { channel: { name: "engineering" }, text: "shipped to staging", ts: "1234567890.000100" },
          { channel: { name: "general" }, text: "good morning", ts: "1234567891.000200" },
        ],
      },
    });

    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger: makeLogger() });
    const result = await port.getMessageSample("user1");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ channel: "engineering", text: "shipped to staging", ts: "1234567890.000100" });
    expect(result[1]).toMatchObject({ channel: "general", text: "good morning", ts: "1234567891.000200" });
  });

  it("filters out empty-text messages", async () => {
    mockSearchMessages.mockResolvedValueOnce({
      messages: {
        matches: [
          { channel: { name: "engineering" }, text: "", ts: "1234567890.000100" },
          { channel: { name: "general" }, text: "hello", ts: "1234567891.000200" },
        ],
      },
    });

    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger: makeLogger() });
    const result = await port.getMessageSample("user1");

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hello");
  });

  it("returns [] and logs warning when API throws", async () => {
    mockSearchMessages.mockRejectedValueOnce(new Error("search error"));

    const logger = makeLogger();
    const port = createSlackDiscoveryPort({ resolveCreds: makeResolveCreds("xoxp-test"), logger });
    const result = await port.getMessageSample("user1");

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
