import type { gmail_v1 } from "googleapis";
import { describe, expect, it, vi } from "vitest";
import { _executeGmailGetMessage, _executeGmailSearch } from "../../src/tools/google/gmail.js";

// ---------------------------------------------------------------------------
// Mock helper
// ---------------------------------------------------------------------------

const makeGmailClient = (overrides: { list?: ReturnType<typeof vi.fn>; get?: ReturnType<typeof vi.fn> }) =>
  ({
    users: {
      messages: {
        list: overrides.list ?? vi.fn().mockResolvedValue({ data: { messages: [] } }),
        get: overrides.get ?? vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  }) as unknown as gmail_v1.Gmail;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseInput = { query: "from:mom subject:trip", maxResults: 10 };

const makeListResponse = (ids: string[]) => ({
  data: { messages: ids.map((id) => ({ id })) },
});

const makeGetResponse = (overrides: {
  id?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  snippet?: string;
  internalDate?: string;
}) => ({
  data: {
    threadId: overrides.threadId ?? "thread-1",
    snippet: overrides.snippet ?? "Hello from mom",
    internalDate: overrides.internalDate ?? "1715000000000",
    payload: {
      headers: [
        { name: "Subject", value: overrides.subject ?? "Trip planning" },
        { name: "From", value: overrides.from ?? "Mom <mom@example.com>" },
        { name: "Date", value: "Mon, 6 May 2026 10:00:00 -0500" },
      ],
    },
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("_executeGmailSearch", () => {
  // 1. Happy path — messages found
  it("returns metadata for each message when results are found", async () => {
    const getMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeGetResponse({
          id: "msg-1",
          threadId: "thread-1",
          subject: "Trip planning",
          from: "Mom <mom@example.com>",
          snippet: "Hello from mom",
          internalDate: "1715000000000",
        }),
      )
      .mockResolvedValueOnce(
        makeGetResponse({
          id: "msg-2",
          threadId: "thread-2",
          subject: "Re: Trip planning",
          from: "Mom <mom@example.com>",
          snippet: "See you soon",
          internalDate: "1715100000000",
        }),
      );

    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue(makeListResponse(["msg-1", "msg-2"])),
      get: getMock,
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect("messages" in result).toBe(true);
    if (!("messages" in result)) return;

    expect(result.count).toBe(2);

    const first = result.messages[0]!;
    expect(first.id).toBe("msg-1");
    expect(first.threadId).toBe("thread-1");
    expect(first.subject).toBe("Trip planning");
    expect(first.from).toBe("Mom <mom@example.com>");
    expect(first.snippet).toBe("Hello from mom");
    expect(first.internalDate).toBe("1715000000000");

    const second = result.messages[1]!;
    expect(second.id).toBe("msg-2");
    expect(second.threadId).toBe("thread-2");
    expect(second.subject).toBe("Re: Trip planning");
    expect(second.snippet).toBe("See you soon");
  });

  // 2. No results — empty messages array
  it("returns { messages: [], count: 0 } when list returns no messages", async () => {
    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect("messages" in result).toBe(true);
    if (!("messages" in result)) return;

    expect(result.messages).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("returns { messages: [], count: 0 } when list returns undefined messages", async () => {
    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue({ data: {} }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect("messages" in result).toBe(true);
    if (!("messages" in result)) return;

    expect(result.messages).toEqual([]);
    expect(result.count).toBe(0);
  });

  // 3. Missing headers — defaults to empty string
  it("defaults subject to empty string when Subject header is absent", async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: {
        threadId: "thread-1",
        snippet: "No subject here",
        internalDate: "1715000000000",
        payload: {
          headers: [
            // No Subject header — only From
            { name: "From", value: "someone@example.com" },
          ],
        },
      },
    });

    const client = makeGmailClient({
      list: vi.fn().mockResolvedValue(makeListResponse(["msg-1"])),
      get: getMock,
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect("messages" in result).toBe(true);
    if (!("messages" in result)) return;

    expect(result.messages[0]?.subject).toBe("");
    expect(result.messages[0]?.from).toBe("someone@example.com");
  });

  // 4. Auth error (401)
  it('returns { error: "auth_error" } on 401', async () => {
    const client = makeGmailClient({
      list: vi.fn().mockRejectedValue({ code: 401, message: "invalid_grant" }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;

    expect(result.error).toBe("auth_error");
    expect(result.message).toContain("401");
    expect(result.message).toContain("invalid_grant");
  });

  // 5. Auth error (403)
  it('returns { error: "auth_error" } on 403', async () => {
    const client = makeGmailClient({
      list: vi.fn().mockRejectedValue({ code: 403 }),
    });

    const result = await _executeGmailSearch(client, baseInput);

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;

    expect(result.error).toBe("auth_error");
    expect(result.message).toContain("403");
  });

  // 6. maxResults passed through to messages.list
  it("passes maxResults through to the Gmail API list call", async () => {
    const listMock = vi.fn().mockResolvedValue({ data: { messages: [] } });
    const client = makeGmailClient({ list: listMock });

    await _executeGmailSearch(client, { ...baseInput, maxResults: 5 });

    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 5 }));
  });
});

// ---------------------------------------------------------------------------
// _executeGmailGetMessage tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal gmail_v1.Gmail mock for the get-message path.
 * The `get` mock is used for both the search path (format: 'metadata')
 * and the get-message path (format: 'full').
 */
const makeGetMessageClient = (getMock: ReturnType<typeof vi.fn>) =>
  ({
    users: {
      messages: {
        list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
        get: getMock,
      },
    },
  }) as unknown as gmail_v1.Gmail;

/** Encode a string as base64url (Gmail's encoding for body.data). */
function toBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const makeFullMessageResponse = (overrides: {
  id?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  plainBody?: string;
  htmlBody?: string;
}) => {
  const parts: gmail_v1.Schema$MessagePart[] = [];
  if (overrides.plainBody !== undefined) {
    parts.push({
      mimeType: "text/plain",
      body: { data: toBase64Url(overrides.plainBody) },
    });
  }
  if (overrides.htmlBody !== undefined) {
    parts.push({
      mimeType: "text/html",
      body: { data: toBase64Url(overrides.htmlBody) },
    });
  }

  return {
    data: {
      id: overrides.id ?? "msg-full-1",
      threadId: overrides.threadId ?? "thread-full-1",
      payload: {
        headers: [
          { name: "Subject", value: overrides.subject ?? "Test Subject" },
          { name: "From", value: overrides.from ?? "sender@example.com" },
        ],
        parts,
      },
    },
  };
};

describe("_executeGmailGetMessage", () => {
  // 1. Happy path — plain text body
  it("returns decoded plain-text body, truncated: false for small message", async () => {
    const bodyText = "Hello, this is the email body.";
    const getMock = vi
      .fn()
      .mockResolvedValue(makeFullMessageResponse({ plainBody: bodyText, subject: "Hello", from: "alice@example.com" }));
    const client = makeGetMessageClient(getMock);

    const result = await _executeGmailGetMessage(client, { messageId: "msg-full-1" });

    expect("body" in result).toBe(true);
    if (!("body" in result)) return;

    expect(result.id).toBe("msg-full-1");
    expect(result.threadId).toBe("thread-full-1");
    expect(result.subject).toBe("Hello");
    expect(result.from).toBe("alice@example.com");
    expect(result.body).toBe(bodyText);
    expect(result.truncated).toBe(false);
  });

  // 2. HTML fallback — no text/plain part
  it("strips HTML tags when only text/html part is present", async () => {
    const htmlBody = "<p>Hello <b>world</b>!</p>";
    const getMock = vi.fn().mockResolvedValue(makeFullMessageResponse({ htmlBody }));
    const client = makeGetMessageClient(getMock);

    const result = await _executeGmailGetMessage(client, { messageId: "msg-html-1" });

    expect("body" in result).toBe(true);
    if (!("body" in result)) return;

    // Tags should be stripped; text content preserved
    expect(result.body).not.toContain("<p>");
    expect(result.body).not.toContain("<b>");
    expect(result.body).toContain("Hello");
    expect(result.body).toContain("world");
    expect(result.truncated).toBe(false);
  });

  // 3. Truncation — body > 50 KB
  it("truncates body to 50 KB and sets truncated: true", async () => {
    const bigBody = "x".repeat(60 * 1024); // 60 KB
    const getMock = vi.fn().mockResolvedValue(makeFullMessageResponse({ plainBody: bigBody }));
    const client = makeGetMessageClient(getMock);

    const result = await _executeGmailGetMessage(client, { messageId: "msg-big-1" });

    expect("body" in result).toBe(true);
    if (!("body" in result)) return;

    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(50 * 1024);
  });

  // 4. Message not found (404)
  it('returns { error: "not_found" } on 404', async () => {
    const getMock = vi.fn().mockRejectedValue({ code: 404, message: "Not Found" });
    const client = makeGetMessageClient(getMock);

    const result = await _executeGmailGetMessage(client, { messageId: "missing-id" });

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;

    expect(result.error).toBe("not_found");
  });

  // 5. Auth error (401)
  it('returns { error: "auth_error" } on 401', async () => {
    const getMock = vi.fn().mockRejectedValue({ code: 401, message: "invalid_grant" });
    const client = makeGetMessageClient(getMock);

    const result = await _executeGmailGetMessage(client, { messageId: "msg-auth-fail" });

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;

    expect(result.error).toBe("auth_error");
    expect(result.message).toContain("401");
  });
});
