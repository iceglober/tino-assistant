import { describe, expect, it, vi } from "vitest";
import { readersFor } from "../../src/application/readers.js";
import type { ChannelDirectory } from "../../src/ports/outbound.js";
import { makeConfigStore, noopLogger } from "../_fakes.js";

const asker = { id: "u1", slackUserId: "U1" };
const channel = { kind: "channel" as const, channelId: "C1", threadTs: "1.0" };

function directory(
  opts: { outsiders?: boolean | null; channels?: string[]; channelsFail?: boolean } = {},
): ChannelDirectory {
  return {
    describeChannel: vi.fn(async () =>
      opts.outsiders === null ? null : { includesOutsiders: opts.outsiders ?? false },
    ),
    channelsOfSlackUser: vi.fn(async () => {
      if (opts.channelsFail) throw new Error("boom");
      return new Set(opts.channels ?? []);
    }),
  };
}

const deps = (dir: ChannelDirectory | null, config = makeConfigStore()) => ({
  directory: dir,
  config,
  logger: noopLogger(),
});

describe("readersFor", () => {
  it("a Slack DM or the web chat is read only by the asker, who carries their channels", async () => {
    for (const kind of ["slack_dm", "web_chat"] as const) {
      const r = await readersFor({ kind }, asker, deps(directory({ channels: ["C1", "C2"] })));
      expect(r.soleReaderId).toBe("u1");
      expect(r.includesOutsiders).toBe(false);
      expect([...r.channelsAllReadersAreIn].sort()).toEqual(["C1", "C2"]);
    }
  });

  it("someone with no Slack link, or Slack offline, recalls no channels", async () => {
    expect(
      (await readersFor({ kind: "web_chat" }, { id: "u1", slackUserId: null }, deps(directory())))
        .channelsAllReadersAreIn.size,
    ).toBe(0);
    expect((await readersFor({ kind: "web_chat" }, asker, deps(null))).channelsAllReadersAreIn.size).toBe(0);
    expect(
      (await readersFor({ kind: "web_chat" }, asker, deps(directory({ channelsFail: true })))).channelsAllReadersAreIn
        .size,
    ).toBe(0);
  });

  it("an internal channel is read by its members", async () => {
    const r = await readersFor(channel, asker, deps(directory({ outsiders: false })));
    expect(r).toEqual({ soleReaderId: null, includesOutsiders: false, channelsAllReadersAreIn: new Set(["C1"]) });
  });

  it("a channel with outsiders says so", async () => {
    expect((await readersFor(channel, asker, deps(directory({ outsiders: true })))).includesOutsiders).toBe(true);
  });

  it("a channel Slack won't describe is assumed to have outsiders", async () => {
    expect((await readersFor(channel, asker, deps(directory({ outsiders: null })))).includesOutsiders).toBe(true);
    expect((await readersFor(channel, asker, deps(null))).includesOutsiders).toBe(true);
  });

  it("the 'asker' policy treats a mention as read only by the asker", async () => {
    const config = makeConfigStore({ "slack.channelMentions": "asker" });
    const r = await readersFor(channel, asker, deps(directory({ channels: ["C9"] }), config));
    expect(r.soleReaderId).toBe("u1");
    expect([...r.channelsAllReadersAreIn].sort()).toEqual(["C1", "C9"]);
  });

  it("an unrecognized policy value is the cautious one", async () => {
    const config = makeConfigStore({ "slack.channelMentions": "everything" });
    expect((await readersFor(channel, asker, deps(directory(), config))).soleReaderId).toBeNull();
  });
});
