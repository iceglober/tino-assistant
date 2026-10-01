import type { webApi } from "@slack/bolt";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  everyoneInWorkspace,
  membersOfChannel,
  onlyUser,
  onlyUserInChannel,
  type Readers,
} from "../../src/domain/who-can-see.js";
import { buildMyKnowledgeTools, buildWorkspaceKnowledgeTools } from "../../src/infrastructure/driven/tools/kb.js";
import {
  createToolProvider,
  type ToolGroup,
  type ToolSources,
} from "../../src/infrastructure/driven/tools/provider.js";
import {
  publicChannelGuard,
  slackReadChannelTool,
  slackReadThisChannelTool,
} from "../../src/infrastructure/driven/tools/slack/channels.js";
import { noopLogger } from "../server/_helpers.js";

const dm: Readers = { soleReaderId: "u1", includesOutsiders: false, channelsAllReadersAreIn: new Set(["C1"]) };
const internal: Readers = { soleReaderId: null, includesOutsiders: false, channelsAllReadersAreIn: new Set(["C1"]) };
const shared: Readers = { soleReaderId: null, includesOutsiders: true, channelsAllReadersAreIn: new Set(["C1"]) };

function sources(over: Partial<ToolSources> = {}) {
  const s = {
    slack: () => ({
      publicChannels: () => ({ slack_read_channel: {} }) as ToolSet,
      thisChannel: (c: string) => ({ slack_read_this_channel: { c } }) as unknown as ToolSet,
    }),
    gmailAndCalendar: vi.fn(async () => ({ gmail_search: {} }) as ToolSet),
    mySlackMessages: vi.fn(async () => ({ slack_search_my_messages: {} }) as ToolSet),
    myKnowledge: vi.fn(async () => ({ kb_what_you_know: {} }) as ToolSet),
    workspaceKnowledge: vi.fn(async () => ({ kb_what_the_workspace_knows: {} }) as ToolSet),
    mcp: vi.fn(
      async (userId: string): Promise<ToolGroup[]> => [
        {
          name: "mcp:ws-shareable",
          whoCanSeeResults: everyoneInWorkspace,
          build: vi.fn(async () => ({ mcp_linear_x: {} }) as ToolSet),
        },
        {
          name: "mcp:ws-private",
          whoCanSeeResults: onlyUser(userId),
          build: vi.fn(async () => ({ mcp_hr_x: {} }) as ToolSet),
        },
      ],
    ),
    logger: noopLogger(),
    ...over,
  };
  return s;
}

const names = (t: unknown) => Object.keys(t as object).sort();

describe("tool provider: only groups the readers may see", () => {
  it("a DM gets everything the person has", async () => {
    const r = await createToolProvider(sources()).toolsFor({ userId: "u1", readers: dm });
    expect(names(r.tools)).toEqual([
      "gmail_search",
      "kb_what_the_workspace_knows",
      "kb_what_you_know",
      "mcp_hr_x",
      "mcp_linear_x",
      "slack_read_channel",
      "slack_search_my_messages",
    ]);
    expect(r.whoCanSeeResults).toEqual(onlyUser("u1"));
  });

  it("an internal channel gets workspace tools and this channel — private groups are never built", async () => {
    const s = sources();
    const r = await createToolProvider(s).toolsFor({ userId: "u1", readers: internal, askedInChannelId: "C1" });
    expect(names(r.tools)).toEqual([
      "kb_what_the_workspace_knows",
      "mcp_linear_x",
      "slack_read_channel",
      "slack_read_this_channel",
    ]);
    expect(s.gmailAndCalendar).not.toHaveBeenCalled();
    expect(s.mySlackMessages).not.toHaveBeenCalled();
    expect(s.myKnowledge).not.toHaveBeenCalled();
    const mcpGroups = await s.mcp.mock.results[0]?.value;
    expect(mcpGroups[1].build).not.toHaveBeenCalled(); // never connects to a private-results server
    expect(r.whoCanSeeResults).toEqual(membersOfChannel("C1", { insidersOnly: true }));
  });

  it("a channel with outsiders gets only that channel", async () => {
    const s = sources();
    const r = await createToolProvider(s).toolsFor({ userId: "u1", readers: shared, askedInChannelId: "C1" });
    expect(names(r.tools)).toEqual(["slack_read_this_channel"]);
    expect(s.workspaceKnowledge).not.toHaveBeenCalled();
    expect(r.whoCanSeeResults).toEqual(membersOfChannel("C1"));
  });

  it("the 'asker' policy (sole reader in a channel) labels the reply as theirs, while they're in it", async () => {
    const r = await createToolProvider(sources()).toolsFor({ userId: "u1", readers: dm, askedInChannelId: "C1" });
    expect(names(r.tools)).toContain("gmail_search");
    expect(r.whoCanSeeResults).toEqual(onlyUserInChannel("u1", "C1"));
  });

  it("groups that contribute nothing don't narrow the label; none at all is null", async () => {
    const empty = async () => ({}) as ToolSet;
    const s = sources({
      gmailAndCalendar: vi.fn(empty),
      mySlackMessages: vi.fn(empty),
      myKnowledge: vi.fn(empty),
      mcp: vi.fn(async () => []),
    });
    expect((await createToolProvider(s).toolsFor({ userId: "u1", readers: dm })).whoCanSeeResults).toEqual(
      everyoneInWorkspace,
    );

    const none = sources({
      slack: () => ({ publicChannels: () => ({}), thisChannel: () => ({}) }),
      gmailAndCalendar: vi.fn(empty),
      mySlackMessages: vi.fn(empty),
      myKnowledge: vi.fn(empty),
      workspaceKnowledge: vi.fn(empty),
      mcp: vi.fn(async () => []),
    });
    expect((await createToolProvider(none).toolsFor({ userId: "u1", readers: dm })).whoCanSeeResults).toBeNull();
  });

  it("one failing group doesn't take the others down", async () => {
    const s = sources({ gmailAndCalendar: vi.fn(async () => Promise.reject(new Error("google down"))) });
    const r = await createToolProvider(s).toolsFor({ userId: "u1", readers: dm });
    expect(names(r.tools)).not.toContain("gmail_search");
    expect(names(r.tools)).toContain("slack_search_my_messages");
  });

  it("offers continue_in_dm only when asked to, and it takes no input", async () => {
    const provider = createToolProvider(sources());
    expect(names((await provider.toolsFor({ userId: "u1", readers: internal })).tools)).not.toContain("continue_in_dm");

    const requestFollowUp = vi.fn();
    const r = await provider.toolsFor({ userId: "u1", readers: internal, continueInDm: requestFollowUp });
    const t = (r.tools as ToolSet).continue_in_dm;
    expect(t).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: AI SDK types execute as optional
    const out = await t!.execute!({}, { toolCallId: "t", messages: [] });
    expect(out).toMatchObject({ sentToDm: true });
    expect(requestFollowUp).toHaveBeenCalledTimes(1);
  });
});

describe("bot-token channel tools", () => {
  const client = (channels: Record<string, { is_private?: boolean; is_im?: boolean; is_mpim?: boolean }>) =>
    ({
      conversations: {
        info: vi.fn(async ({ channel }: { channel: string }) => {
          if (!(channel in channels)) throw new Error("channel_not_found");
          return { channel: channels[channel] };
        }),
        history: vi.fn(async ({ channel }: { channel: string }) => ({
          messages: [{ user: "U1", text: `in ${channel}`, ts: "1.0" }],
        })),
      },
    }) as unknown as webApi.WebClient;

  // biome-ignore lint/style/noNonNullAssertion: AI SDK types execute as optional
  const run = async (t: ReturnType<typeof slackReadChannelTool>, input: object) =>
    (await t.execute!(input as never, { toolCallId: "t", messages: [] })) as Record<string, unknown>;

  it("the general tools read public channels only, and fail closed", async () => {
    const c = client({ CPUB: {}, CPRIV: { is_private: true }, DIM: { is_im: true }, GMP: { is_mpim: true } });
    const t = slackReadChannelTool(c, publicChannelGuard(c));
    expect((await run(t, { channel: "CPUB", limit: 5 })).count).toBe(1);
    for (const channel of ["CPRIV", "DIM", "GMP", "CGONE"]) {
      expect((await run(t, { channel, limit: 5 })).error).toBe("not_public");
    }
  });

  it("the this-channel tool is locked to one channel, whatever the model passes", async () => {
    const c = client({});
    const t = slackReadThisChannelTool(c, "CPRIV");
    const out = await run(t as unknown as ReturnType<typeof slackReadChannelTool>, { channel: "COTHER", limit: 5 });
    expect((out.messages as Array<{ text: string }>)[0]?.text).toBe("in CPRIV");
  });
});

describe("knowledge-base groups", () => {
  const deps = () => {
    const searchFacts = vi.fn(async () => []);
    return {
      searchFacts,
      deps: {
        store: {
          stats: vi.fn(async () => ({ chunks: 5, oldestMs: 1, newestMs: 2 })),
          listFacts: vi.fn(async () => ({ items: [], total: 3, kinds: [] })),
          searchFacts,
        },
        embedder: { embedQuery: vi.fn(async () => [0.1]), embedDocuments: vi.fn() },
        config: { getTyped: vi.fn(async (_k: string, d: unknown) => d) },
        logger: noopLogger(),
      } as unknown as Parameters<typeof buildMyKnowledgeTools>[1],
    };
  };

  it("workspace knowledge only ever searches the workspace scope", async () => {
    const { deps: d, searchFacts } = deps();
    const tools = await buildWorkspaceKnowledgeTools(d);
    expect(names(tools)).toEqual(["kb_search_workspace", "kb_what_the_workspace_knows"]);
    // biome-ignore lint/style/noNonNullAssertion: AI SDK types execute as optional
    await tools.kb_what_the_workspace_knows!.execute!({ query: "q", topK: 5 } as never, {
      toolCallId: "t",
      messages: [],
    });
    expect(searchFacts).toHaveBeenCalledWith(expect.objectContaining({ scope: "workspace", userId: "" }));
  });

  it("a person's knowledge only ever searches their private scope", async () => {
    const { deps: d, searchFacts } = deps();
    const tools = await buildMyKnowledgeTools("kb-owner", d);
    expect(names(tools)).toEqual(["kb_search_mine", "kb_what_you_know"]);
    // biome-ignore lint/style/noNonNullAssertion: AI SDK types execute as optional
    await tools.kb_what_you_know!.execute!({ query: "q", topK: 5, scope: "workspace" } as never, {
      toolCallId: "t",
      messages: [],
    });
    expect(searchFacts).toHaveBeenCalledWith(expect.objectContaining({ scope: "private", userId: "kb-owner" }));
  });
});
