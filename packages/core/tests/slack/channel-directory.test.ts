import { describe, expect, it, vi } from "vitest";
import {
  createSlackChannelDirectory,
  type SlackDirectoryClient,
} from "../../src/infrastructure/driven/slack/channel-directory.js";
import { noopLogger } from "../server/_helpers.js";

interface FakeChannel {
  info?: { is_ext_shared?: boolean; is_pending_ext_shared?: boolean };
  members?: string[];
  fails?: boolean;
}

function fakeSlack(opts: {
  channels: Record<string, FakeChannel>;
  users?: Array<{
    id: string;
    team_id?: string;
    is_restricted?: boolean;
    is_ultra_restricted?: boolean;
    deleted?: boolean;
  }>;
  userChannels?: Record<string, string[][]>; // pages
}) {
  const client = {
    auth: { test: vi.fn(async () => ({ team_id: "T1" })) },
    conversations: {
      info: vi.fn(async ({ channel }: { channel: string }) => {
        const c = opts.channels[channel];
        if (!c || c.fails) throw new Error("channel_not_found");
        return { channel: c.info ?? {} };
      }),
      members: vi.fn(async ({ channel, cursor }: { channel: string; cursor?: string }) => {
        const all = opts.channels[channel]?.members ?? [];
        // Two pages, to exercise paging.
        const half = Math.ceil(all.length / 2);
        return cursor
          ? { members: all.slice(half) }
          : { members: all.slice(0, half), response_metadata: { next_cursor: all.length > 1 ? "p2" : "" } };
      }),
    },
    users: {
      list: vi.fn(async () => ({ members: opts.users ?? [] })),
      conversations: vi.fn(async ({ user, cursor }: { user: string; cursor?: string }) => {
        const pages = opts.userChannels?.[user] ?? [[]];
        const index = cursor ? Number(cursor) : 0;
        return {
          channels: (pages[index] ?? []).map((id) => ({ id })),
          response_metadata: { next_cursor: index + 1 < pages.length ? String(index + 1) : "" },
        };
      }),
    },
  };
  return client;
}

const staff = [
  { id: "U1", team_id: "T1" },
  { id: "U2", team_id: "T1" },
  { id: "BOT", team_id: "T1" },
];

describe("slack channel directory", () => {
  it("an internal channel of staff has no outsiders", async () => {
    const slack = fakeSlack({ channels: { C1: { members: ["U1", "U2", "BOT"] } }, users: staff });
    const dir = createSlackChannelDirectory(slack as unknown as SlackDirectoryClient, noopLogger());
    expect(await dir.describeChannel("C1")).toEqual({ includesOutsiders: false });
  });

  it.each([
    ["a Slack Connect channel", { info: { is_ext_shared: true }, members: ["U1"] }],
    ["a pending Slack Connect invite", { info: { is_pending_ext_shared: true }, members: ["U1"] }],
    ["a single-channel guest", { members: ["U1", "G1"] }],
    ["a multi-channel guest", { members: ["U1", "G2"] }],
    ["someone from another team", { members: ["U1", "X1"] }],
    ["someone not in our directory", { members: ["U1", "UNKNOWN"] }],
    ["a deactivated account", { members: ["U1", "GONE"] }],
  ])("%s means outsiders", async (_name, channel) => {
    const slack = fakeSlack({
      channels: { C1: channel },
      users: [
        ...staff,
        { id: "G1", team_id: "T1", is_ultra_restricted: true },
        { id: "G2", team_id: "T1", is_restricted: true },
        { id: "X1", team_id: "T2" },
        { id: "GONE", team_id: "T1", deleted: true },
      ],
    });
    const dir = createSlackChannelDirectory(slack as unknown as SlackDirectoryClient, noopLogger());
    expect(await dir.describeChannel("C1")).toEqual({ includesOutsiders: true });
  });

  it("returns null when Slack can't describe the channel", async () => {
    const slack = fakeSlack({ channels: { C1: { fails: true } }, users: staff });
    const dir = createSlackChannelDirectory(slack as unknown as SlackDirectoryClient, noopLogger());
    expect(await dir.describeChannel("C1")).toBeNull();
  });

  it("caches channel answers and the user directory", async () => {
    const slack = fakeSlack({ channels: { C1: { members: ["U1"] }, C2: { members: ["U2"] } }, users: staff });
    const dir = createSlackChannelDirectory(slack as unknown as SlackDirectoryClient, noopLogger());
    await dir.describeChannel("C1");
    await dir.describeChannel("C1");
    await dir.describeChannel("C2");
    expect(slack.conversations.info).toHaveBeenCalledTimes(2);
    expect(slack.users.list).toHaveBeenCalledTimes(1);
  });

  it("lists every channel a person is in, across pages", async () => {
    const slack = fakeSlack({ channels: {}, userChannels: { U1: [["C1", "C2"], ["C3"]] } });
    const dir = createSlackChannelDirectory(slack as unknown as SlackDirectoryClient, noopLogger());
    expect([...(await dir.channelsOfSlackUser("U1"))].sort()).toEqual(["C1", "C2", "C3"]);
    await dir.channelsOfSlackUser("U1");
    expect(slack.users.conversations).toHaveBeenCalledTimes(2); // two pages, then cached
  });
});
