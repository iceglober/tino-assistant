import { describe, expect, it, vi } from "vitest";
import { buildSlackUserTools } from "../../src/infrastructure/driven/tools/slack-user.js";
import type { CapabilityConfig } from "../../src/domain/types.js";
import type { ConfigStore, Logger, UserCapabilityStore } from "../../src/ports/outbound.js";

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const configStore = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn(),
  delete: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  getTyped: vi.fn(),
} as unknown as ConfigStore;

const capStore = (cfg: CapabilityConfig | null): UserCapabilityStore =>
  ({ get: vi.fn().mockResolvedValue(cfg), set: vi.fn(), list: vi.fn(), delete: vi.fn() }) as unknown as UserCapabilityStore;

describe("buildSlackUserTools", () => {
  it("returns {} when the user has not connected Slack", async () => {
    const tools = await buildSlackUserTools("u1", configStore, capStore(null), logger);
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it("builds the personal Slack tools when a user token is stored", async () => {
    const cfg: CapabilityConfig = {
      enabled: true,
      credentials: { userToken: "xoxp-fake", slackUserId: "U1" },
      settings: {},
    };
    const tools = await buildSlackUserTools("u1", configStore, capStore(cfg), logger);
    expect(Object.keys(tools).sort()).toEqual([
      "slack_list_my_conversations",
      "slack_read_my_conversation",
      "slack_search_my_messages",
    ]);
  });
});
