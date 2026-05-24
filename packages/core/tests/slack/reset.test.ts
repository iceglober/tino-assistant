import { describe, expect, test, vi } from "vitest";
import type { HistoryStore } from "../../src/agent/history.js";
import type { IdentityResolver } from "../../src/identity/resolver.js";
import type { UserStore } from "../../src/identity/store.js";
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

const adminUser = {
  id: "tino-uuid-admin",
  email: "admin@acme.io",
  role: "admin" as const,
  status: "active" as const,
  slackUserId: "U_OWNER",
  createdAt: 1000,
  updatedAt: 1000,
};

const memberUser = {
  ...adminUser,
  id: "tino-uuid-member",
  role: "member" as const,
  slackUserId: "U_OTHER",
};

const makeResolver = (tinoUserId: string | null = "tino-uuid-admin"): IdentityResolver => ({
  resolveSlack: vi.fn().mockResolvedValue(tinoUserId),
  resolveGoogle: vi.fn().mockResolvedValue(null),
  provisionFromSlack: vi.fn().mockRejectedValue(new Error("unknown_user")),
});

const makeUsers = (user = adminUser): UserStore => ({
  get: vi.fn().mockResolvedValue(user),
  getByEmail: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  update: vi.fn(),
});

const baseMessage: Partial<DmMessageEvent> = {
  type: "message",
  channel: "D123",
  channel_type: "im",
  user: "U_OWNER",
  text: "reset",
  ts: "1234567890.000200",
};

describe("handleResetCommand", () => {
  test('admin DM with "reset" → history.reset called, returns true', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: baseMessage,
      identityResolver: makeResolver(),
      users: makeUsers(),
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(true);
    expect(history.reset).toHaveBeenCalledOnce();
    expect(history.reset).toHaveBeenCalledWith("tino-uuid-admin");
    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith({ text: "History cleared." });
  });

  test('admin DM with "RESET" (uppercase) → same behavior (case-insensitive)', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, text: "RESET" },
      identityResolver: makeResolver(),
      users: makeUsers(),
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(true);
    expect(history.reset).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith({ text: "History cleared." });
  });

  test('admin DM with "  reset  " (whitespace) → same behavior (trimmed)', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, text: "  reset  " },
      identityResolver: makeResolver(),
      users: makeUsers(),
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(true);
    expect(history.reset).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith({ text: "History cleared." });
  });

  test('admin DM with "reset please" → returns false, history.reset NOT called', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, text: "reset please" },
      identityResolver: makeResolver(),
      users: makeUsers(),
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  test('member DM with "reset" → returns false (non-admin)', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, user: "U_OTHER" },
      identityResolver: makeResolver("tino-uuid-member"),
      users: makeUsers(memberUser),
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  test('unknown user DM with "reset" → returns false', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, user: "U_UNKNOWN" },
      identityResolver: makeResolver(null),
      users: makeUsers(),
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  test('admin in channel with "reset" → returns false (channel_type !== "im")', async () => {
    const history = makeHistory();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const result = await handleResetCommand({
      message: { ...baseMessage, channel_type: "channel" },
      identityResolver: makeResolver(),
      users: makeUsers(),
      history,
      say,
      logger: logger as unknown as Parameters<typeof handleResetCommand>[0]["logger"],
    });

    expect(result).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });
});
