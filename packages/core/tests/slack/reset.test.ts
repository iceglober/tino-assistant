import { describe, expect, test, vi } from "vitest";
import type { HistoryStore } from "../../src/agent/history.js";
import { handleResetCommand } from "../../src/slack/reset.js";
import type { DmMessageEvent } from "../../src/slack/types.js";

const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const makeHistory = (): HistoryStore => ({
  get: vi.fn().mockReturnValue([]),
  append: vi.fn(),
  reset: vi.fn(),
});

const ownerEnv = { ALLOWED_SLACK_USER_ID: "U_OWNER" };

const baseMessage: Partial<DmMessageEvent> = {
  type: "message",
  channel: "D123",
  channel_type: "im",
  user: "U_OWNER",
  text: "reset",
  ts: "1234567890.000200",
};

describe("handleResetCommand", () => {
  test('owner DM with "reset" → history.reset called, say called with "History cleared.", returns true', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: baseMessage,
      env: ownerEnv,
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(true);
    expect(history.reset).toHaveBeenCalledOnce();
    expect(history.reset).toHaveBeenCalledWith("U_OWNER");
    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith({ text: "History cleared." });
  });

  test('owner DM with "RESET" (uppercase) → same behavior (case-insensitive)', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, text: "RESET" },
      env: ownerEnv,
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(true);
    expect(history.reset).toHaveBeenCalledOnce();
    expect(history.reset).toHaveBeenCalledWith("U_OWNER");
    expect(say).toHaveBeenCalledWith({ text: "History cleared." });
  });

  test('owner DM with "  reset  " (whitespace) → same behavior (trimmed)', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, text: "  reset  " },
      env: ownerEnv,
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(true);
    expect(history.reset).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith({ text: "History cleared." });
  });

  test('owner DM with "reset please" → returns false, history.reset NOT called', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, text: "reset please" },
      env: ownerEnv,
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  test('non-owner DM with "reset" → returns false, history.reset NOT called', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, user: "U_OTHER" },
      env: ownerEnv,
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  test('owner in channel with "reset" → returns false (channel_type !== "im")', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, channel_type: "channel" },
      env: ownerEnv,
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });
});
