import { describe, expect, test, vi } from "vitest";
import { handleDmMessage } from "../../src/slack/app.js";
import type { DmMessageEvent } from "../../src/slack/types.js";
import type { IdentityResolver } from "../../src/identity/resolver.js";
import type { UserStore } from "../../src/identity/store.js";
import type { ConfigStore } from "../../src/persistence/config.js";

const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const knownUser = {
  id: "tino-uuid-owner",
  email: "owner@test.io",
  role: "admin" as const,
  status: "active" as const,
  slackUserId: "U_OWNER",
  createdAt: 1000,
  updatedAt: 1000,
};

const makeIdentityResolver = (): IdentityResolver => ({
  resolveSlack: vi.fn().mockResolvedValue("tino-uuid-owner"),
  resolveGoogle: vi.fn().mockResolvedValue(null),
  provisionFromSlack: vi.fn().mockRejectedValue(new Error("unknown_user")),
});

const makeUsers = (): UserStore => ({
  get: vi.fn().mockResolvedValue(knownUser),
  getByEmail: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  update: vi.fn(),
});

const makeConfigStore = (): ConfigStore =>
  ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getTyped: vi.fn(),
  }) as unknown as ConfigStore;

const baseMessage: Partial<DmMessageEvent> = {
  type: "message",
  channel: "D123",
  channel_type: "im",
  user: "U_OWNER",
  text: "hello",
  ts: "1234567890.000100",
};

describe("handleDmMessage", () => {
  test("known user DM → handler called, reply sent", async () => {
    const onDm = vi.fn().mockResolvedValue("echoed: hello");
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    await handleDmMessage({
      message: baseMessage,
      onDm,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]["logger"],
      identityResolver: makeIdentityResolver(),
      users: makeUsers(),
      configStore: makeConfigStore(),
    });

    expect(onDm).toHaveBeenCalledOnce();
    expect(onDm).toHaveBeenCalledWith("tino-uuid-owner", "hello");
    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith({ text: "echoed: hello" });
  });

  test("unknown user DM in allowlist mode → dropped via resolver", async () => {
    const onDm = vi.fn();
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const resolver = makeIdentityResolver();
    (resolver.resolveSlack as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleDmMessage({
      message: { ...baseMessage, user: "U_OTHER" },
      onDm,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]["logger"],
      identityResolver: resolver,
      users: makeUsers(),
      configStore: makeConfigStore(),
    });

    expect(onDm).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("don't recognize") }));
  });

  test("owner in channel → dropped, debug logged", async () => {
    const onDm = vi.fn();
    const say = vi.fn();
    const logger = makeLogger();

    await handleDmMessage({
      message: { ...baseMessage, channel_type: "channel" },
      onDm,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]["logger"],
      identityResolver: makeIdentityResolver(),
      users: makeUsers(),
      configStore: makeConfigStore(),
    });

    expect(onDm).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  test("thread_broadcast subtype → dropped", async () => {
    const onDm = vi.fn();
    const say = vi.fn();
    const logger = makeLogger();

    await handleDmMessage({
      message: { ...baseMessage, subtype: "thread_broadcast" },
      onDm,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]["logger"],
      identityResolver: makeIdentityResolver(),
      users: makeUsers(),
      configStore: makeConfigStore(),
    });

    expect(onDm).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  test("bot_message subtype → dropped", async () => {
    const onDm = vi.fn();
    const say = vi.fn();
    const logger = makeLogger();

    await handleDmMessage({
      message: { ...baseMessage, subtype: "bot_message" },
      onDm,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]["logger"],
      identityResolver: makeIdentityResolver(),
      users: makeUsers(),
      configStore: makeConfigStore(),
    });

    expect(onDm).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });
});
