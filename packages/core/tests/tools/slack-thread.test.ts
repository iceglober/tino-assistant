import type { webApi } from "@slack/bolt";
import { describe, expect, it, vi } from "vitest";
import type { UserCache } from "../../src/slack/userCache.js";
import { _executeSlackReadThread } from "../../src/tools/slack/thread.js";

// ---------------------------------------------------------------------------
// Mock WebClient factory
// ---------------------------------------------------------------------------

function makeClient(repliesMock: ReturnType<typeof vi.fn>): webApi.WebClient {
  return {
    conversations: {
      replies: repliesMock,
    },
  } as unknown as webApi.WebClient;
}

// ---------------------------------------------------------------------------
// Mock UserCache factory
// ---------------------------------------------------------------------------

function makeUserCache(nameMap: Record<string, string>): UserCache {
  return {
    get: (userId: string) => {
      const name = nameMap[userId];
      if (!name) return undefined;
      return { id: userId, name, isBot: false, isExternal: false, teamId: "T001" };
    },
    resolve: async (userId: string) => ({
      id: userId,
      name: nameMap[userId] ?? userId,
      isBot: false,
      isExternal: false,
      teamId: "T001",
    }),
    getAll: () =>
      Object.entries(nameMap).map(([id, name]) => ({ id, name, isBot: false, isExternal: false, teamId: "T001" })),
    size: () => Object.keys(nameMap).length,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("_executeSlackReadThread", () => {
  // 1. Happy path — returns shaped messages with resolved user names
  it("returns messages, count, and hasMore on success", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: "U001", text: "parent message", ts: "1234567890.000100" },
        { user: "U002", text: "first reply", ts: "1234567891.000200" },
        { user: "U001", text: "second reply", ts: "1234567892.000300" },
      ],
      has_more: false,
    });

    const client = makeClient(mock);
    const userCache = makeUserCache({ U001: "Alice", U002: "Bob" });
    const result = await _executeSlackReadThread(
      client,
      {
        channel: "C001",
        threadTs: "1234567890.000100",
        limit: 20,
      },
      userCache,
    );

    expect(result).toMatchObject({
      messages: [
        { user: "U001", userName: "Alice", text: "parent message", ts: "1234567890.000100" },
        { user: "U002", userName: "Bob", text: "first reply", ts: "1234567891.000200" },
        { user: "U001", userName: "Alice", text: "second reply", ts: "1234567892.000300" },
      ],
      count: 3,
      hasMore: false,
    });
  });

  // 2. Thread not found — returns { error: 'thread_not_found' }
  it("returns thread_not_found when Slack throws thread_not_found", async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: "thread_not_found" } });

    const client = makeClient(mock);
    const userCache = makeUserCache({});
    const result = await _executeSlackReadThread(
      client,
      {
        channel: "C001",
        threadTs: "9999999999.000000",
        limit: 20,
      },
      userCache,
    );

    expect(result).toMatchObject({ error: "thread_not_found" });
  });

  // 3. Channel not found — returns { error: 'channel_not_found' }
  it("returns channel_not_found when Slack throws channel_not_found", async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: "channel_not_found" } });

    const client = makeClient(mock);
    const userCache = makeUserCache({});
    const result = await _executeSlackReadThread(
      client,
      {
        channel: "CINVALID",
        threadTs: "1234567890.000100",
        limit: 20,
      },
      userCache,
    );

    expect(result).toMatchObject({ error: "channel_not_found" });
  });

  // 4. Auth error — returns { error: 'auth_error' }
  it("returns auth_error when Slack throws not_authed", async () => {
    const mock = vi.fn().mockRejectedValue({ data: { error: "not_authed" } });

    const client = makeClient(mock);
    const userCache = makeUserCache({});
    const result = await _executeSlackReadThread(
      client,
      {
        channel: "C001",
        threadTs: "1234567890.000100",
        limit: 20,
      },
      userCache,
    );

    expect(result).toMatchObject({ error: "auth_error" });
  });

  // 5. has_more flag is propagated
  it("returns hasMore: true when API returns has_more: true", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { user: "U001", text: "parent", ts: "1234567890.000100" },
        { user: "U002", text: "reply 1", ts: "1234567891.000200" },
      ],
      has_more: true,
    });

    const client = makeClient(mock);
    const userCache = makeUserCache({ U001: "Alice", U002: "Bob" });
    const result = await _executeSlackReadThread(
      client,
      {
        channel: "C001",
        threadTs: "1234567890.000100",
        limit: 2,
      },
      userCache,
    );

    expect(result).toMatchObject({ hasMore: true, count: 2 });
  });

  // 6. Works without userCache (optional parameter)
  it("returns user ID as userName when no userCache provided", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      messages: [{ user: "U001", text: "hello", ts: "1234567890.000100" }],
      has_more: false,
    });

    const client = makeClient(mock);
    const result = await _executeSlackReadThread(client, {
      channel: "C001",
      threadTs: "1234567890.000100",
      limit: 20,
    });

    expect(result).toMatchObject({
      messages: [{ user: "U001", userName: "U001" }],
    });
  });
});
