import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleDmMessage } from "../../src/slack/app.js";
import type { DmMessageEvent } from "../../src/slack/types.js";

/**
 * Wave 0 regression test: bot owner's DM behavior is unchanged.
 *
 * Verifies that after wave 0 migration:
 * - The same DM from ALLOWED_SLACK_USER_ID still triggers the agent
 * - The userId passed to the handler is correct
 * - The message is processed and replied to
 * - Audit logging works as expected
 */
describe("wave0-no-regression", () => {
  const ALLOWED_SLACK_USER_ID = "U12345678";
  const CHANNEL_ID = "D87654321";
  const TEXT = "what time is it?";

  let mockHandler: ReturnType<typeof vi.fn>;
  let mockSay: ReturnType<typeof vi.fn>;
  let mockAuditLogger: {
    log: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockHandler = vi.fn().mockResolvedValue("It's currently 3 PM.");
    mockSay = vi.fn().mockResolvedValue(undefined);
    mockAuditLogger = {
      log: vi.fn().mockResolvedValue(undefined),
    };
  });

  // 1. DM from allowlisted user is routed to handler
  it("accepts and processes DM from ALLOWED_SLACK_USER_ID", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: ALLOWED_SLACK_USER_ID,
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000001",
    };

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      auditLogger: mockAuditLogger,
      seenUsers: new Set(),
    });

    expect(mockHandler).toHaveBeenCalledOnce();
    expect(mockHandler).toHaveBeenCalledWith(ALLOWED_SLACK_USER_ID, TEXT);
    expect(mockSay).toHaveBeenCalledOnce();
    expect(mockSay).toHaveBeenCalledWith({
      text: "It's currently 3 PM.",
    });
  });

  // 2. DM from non-allowlisted user is rejected
  it("rejects DM from non-allowlisted user", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: "UOTHER123",
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000002",
    };

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger,
      auditLogger: mockAuditLogger,
    });

    expect(mockHandler).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ user: "UOTHER123", channel: CHANNEL_ID }),
      expect.stringMatching(/rejected DM/),
    );
  });

  // 3. Non-DM channel message is ignored
  it("ignores non-DM channel messages", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "channel",
      user: ALLOWED_SLACK_USER_ID,
      channel: "C87654321",
      text: TEXT,
      ts: "1234567890.000003",
    };

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger,
    });

    expect(mockHandler).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ channelType: "channel" }),
      expect.stringMatching(/ignored non-DM/),
    );
  });

  // 4. Message with subtype (e.g., bot_message, message_changed) is ignored
  it("ignores messages with subtype", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      subtype: "bot_message",
      channel_type: "im",
      user: ALLOWED_SLACK_USER_ID,
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000004",
    };

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger,
    });

    expect(mockHandler).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ subtype: "bot_message" }),
      expect.stringMatching(/ignored message with subtype/),
    );
  });

  // 5. Message with no user is ignored
  it("ignores DM with no user", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: undefined,
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000005",
    };

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger,
    });

    expect(mockHandler).not.toHaveBeenCalled();
  });

  // 6. Message with no text is ignored
  it("ignores DM with no text", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: ALLOWED_SLACK_USER_ID,
      channel: CHANNEL_ID,
      text: "",
      ts: "1234567890.000006",
    };

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger,
    });

    expect(mockHandler).not.toHaveBeenCalled();
  });

  // 7. Audit logger logs login on first message from user
  it("logs login audit entry on first message from user", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: ALLOWED_SLACK_USER_ID,
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000007",
    };

    const seenUsers = new Set<string>();

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      auditLogger: mockAuditLogger,
      seenUsers,
    });

    expect(mockAuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ALLOWED_SLACK_USER_ID,
        action: "login",
        status: "success",
      }),
    );
    expect(seenUsers.has(ALLOWED_SLACK_USER_ID)).toBe(true);
  });

  // 8. Audit logger does not log login twice for same user
  it("does not log login audit entry on subsequent messages", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: ALLOWED_SLACK_USER_ID,
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000008",
    };

    const seenUsers = new Set<string>();
    seenUsers.add(ALLOWED_SLACK_USER_ID);

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: mockHandler,
      say: mockSay,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      auditLogger: mockAuditLogger,
      seenUsers,
    });

    expect(mockAuditLogger.log).not.toHaveBeenCalled();
  });

  // 9. Handler error is caught and error message is posted
  it("handles handler errors gracefully", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: ALLOWED_SLACK_USER_ID,
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000009",
    };

    const errorHandler = vi.fn().mockRejectedValue(new Error("test error"));
    const errorLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: errorHandler,
      say: mockSay,
      logger: errorLogger,
    });

    expect(mockSay).toHaveBeenCalledWith({
      text: "Something went wrong. Check the logs.",
    });
    expect(errorLogger.error).toHaveBeenCalled();
  });

  // 10. Handler response is formatted as markdown before posting
  it("formats handler response as markdown before posting", async () => {
    const message: Partial<DmMessageEvent> = {
      type: "message",
      channel_type: "im",
      user: ALLOWED_SLACK_USER_ID,
      channel: CHANNEL_ID,
      text: TEXT,
      ts: "1234567890.000010",
    };

    const handlerResponse = "# Header\n\n- item 1\n- item 2";
    const formattedHandler = vi.fn().mockResolvedValue(handlerResponse);

    await handleDmMessage({
      message,
      env: { ALLOWED_SLACK_USER_ID },
      onDmFromOwner: formattedHandler,
      say: mockSay,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(mockSay).toHaveBeenCalledOnce();
    // Just verify it was called; exact formatting is tested elsewhere
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.any(String),
      }),
    );
  });
});
