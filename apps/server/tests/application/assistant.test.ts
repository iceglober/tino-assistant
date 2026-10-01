/**
 * The assistant end to end, with only Slack and the LLM faked: the real
 * use-case, tool provider, readers logic, and sqlite conversation log.
 */

import { createAssistant } from "@tino/core/application/assistant";
import type { TinoUser } from "@tino/core/domain/types";
import { everyoneInWorkspace, onlyUser } from "@tino/core/domain/who-can-see";
import type { Surface } from "@tino/core/ports/inbound";
import type { ChannelDirectory, ChatModel, DirectMessenger, UserStore } from "@tino/core/ports/outbound";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { describeModelMessage } from "../../src/infrastructure/driven/model/describe-message.js";
import { createToolProvider, type ToolGroup } from "../../src/infrastructure/driven/tools/provider.js";
import { memoryConversations } from "../_memory.js";
import { makeConfigStore, noopLogger } from "../server/_helpers.js";

const people: Record<string, TinoUser> = Object.fromEntries(
  ["u1", "u2"].map((id, i) => [
    id,
    {
      id,
      email: `${id}@acme.io`,
      role: "member",
      status: "active",
      slackUserId: `U${i + 1}`,
      createdAt: 1,
      updatedAt: 1,
    },
  ]),
) as Record<string, TinoUser>;

interface Call {
  system: string;
  history: string[];
  userText: string;
  tools: string[];
}

function world(
  opts: {
    policy?: string;
    outsidersIn?: string[];
    memberships?: Record<string, string[]>;
    slackOffline?: boolean;
    messengerFails?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  /** What the fake model does next: its reply text, and whether it calls continue_in_dm. */
  const plan: Array<{ reply?: string; callContinueInDm?: number; withToolRoundTrip?: boolean }> = [];

  const model: ChatModel = {
    async reply({ system, history, userText, tools }) {
      const toolSet = tools as ToolSet;
      const text = (m: unknown) => describeModelMessage(m).text ?? `<${describeModelMessage(m).role}>`;
      calls.push({ system, history: history.map(text), userText, tools: Object.keys(toolSet).sort() });
      const step = plan.shift() ?? {};
      for (let i = 0; i < (step.callContinueInDm ?? 0); i++) {
        // biome-ignore lint/style/noNonNullAssertion: AI SDK types execute as optional
        await toolSet.continue_in_dm!.execute!({}, { toolCallId: `c${i}`, messages: [] });
      }
      const replyText = step.reply ?? `answer to: ${userText.split("\n").pop()}`;
      const user = { role: "user", content: userText };
      const newMessages = step.withToolRoundTrip
        ? [
            user,
            { role: "assistant", content: [{ type: "tool-call", toolCallId: "x", toolName: "t", input: {} }] },
            {
              role: "tool",
              content: [{ type: "tool-result", toolCallId: "x", toolName: "t", output: { type: "text", value: "r" } }],
            },
            { role: "assistant", content: [{ type: "text", text: replyText }] },
          ]
        : [user, { role: "assistant", content: [{ type: "text", text: replyText }] }];
      return { text: replyText, newMessages };
    },
    describe: describeModelMessage,
  };

  const group = (name: string, whoCanSeeResults: ToolGroup["whoCanSeeResults"], tool: string): ToolGroup => ({
    name,
    whoCanSeeResults,
    build: async () => ({ [tool]: {} }) as ToolSet,
  });
  const tools = createToolProvider({
    slack: () => ({
      publicChannels: () => ({ slack_read_channel: {} }) as ToolSet,
      thisChannel: () => ({ slack_read_this_channel: {} }) as ToolSet,
    }),
    gmailAndCalendar: async () => ({ gmail_search: {} }) as ToolSet,
    mySlackMessages: async () => ({ slack_search_my_messages: {} }) as ToolSet,
    myKnowledge: async () => ({ kb_what_you_know: {} }) as ToolSet,
    workspaceKnowledge: async () => ({ kb_what_the_workspace_knows: {} }) as ToolSet,
    mcp: async (userId) => [
      group("hr", onlyUser(userId), "mcp_hr_lookup"),
      group("linear", everyoneInWorkspace, "mcp_linear_search"),
    ],
    logger: noopLogger(),
  });

  const directory: ChannelDirectory = {
    describeChannel: async (c) => ({ includesOutsiders: (opts.outsidersIn ?? []).includes(c) }),
    channelsOfSlackUser: async (slackId) => new Set((opts.memberships ?? {})[slackId] ?? []),
  };
  const sent: Array<{ userId: string; text: string }> = [];
  const messenger: DirectMessenger = {
    sendToUser: vi.fn(async (userId, text) => {
      if (opts.messengerFails) throw new Error("slack said no");
      sent.push({ userId, text });
    }),
  };
  const users = { get: async (id: string) => people[id] ?? null } as unknown as UserStore;
  const conversations = memoryConversations();

  const assistant = createAssistant({
    model,
    tools,
    conversations,
    users,
    config: makeConfigStore(opts.policy ? { "slack.channelMentions": opts.policy } : {}),
    directory: () => directory,
    messenger: () => (opts.slackOffline ? null : messenger),
    logger: noopLogger(),
  });

  const settle = () => new Promise((r) => setTimeout(r, 20)); // lets the DM follow-up finish
  return { assistant, calls, plan, sent, conversations, settle };
}

const dm: Surface = { kind: "slack_dm" };
const web: Surface = { kind: "web_chat" };
const inSales = (threadTs = "100.0"): Surface => ({
  kind: "channel",
  channelId: "CSALES",
  threadTs,
  recentChannelMessages: "[recent: <@U9>: acme renewal is due friday]",
  permalink: "https://acme.slack.com/archives/CSALES/p100",
});

describe("what a reply may use depends on who reads it", () => {
  it("a DM gets every tool the person has", async () => {
    const w = world();
    await w.assistant.handleMessage("u1", "what did sarah email me?", dm);
    expect(w.calls[0]?.tools).toEqual([
      "gmail_search",
      "kb_what_the_workspace_knows",
      "kb_what_you_know",
      "mcp_hr_lookup",
      "mcp_linear_search",
      "slack_read_channel",
      "slack_search_my_messages",
    ]);
  });

  it("a channel reply gets only what the channel may see, plus a way to continue in DM", async () => {
    const w = world();
    await w.assistant.handleMessage("u1", "where are we on acme?", inSales());
    expect(w.calls[0]?.tools).toEqual([
      "continue_in_dm",
      "kb_what_the_workspace_knows",
      "mcp_linear_search",
      "slack_read_channel",
      "slack_read_this_channel",
    ]);
    expect(w.calls[0]?.system).toContain("Everyone in the channel reads your replies");
    expect(w.calls[0]?.userText).toContain("acme renewal is due friday"); // channel context still arrives
  });

  it("a channel with outsiders gets only that channel", async () => {
    const w = world({ outsidersIn: ["CSALES"] });
    await w.assistant.handleMessage("u1", "our target price?", inSales());
    expect(w.calls[0]?.tools).toEqual(["continue_in_dm", "slack_read_this_channel"]);
    expect(w.calls[0]?.system).toContain("People from outside the company are in this channel");
  });

  it("without Slack connected, a channel reply can't offer the DM hand-off", async () => {
    const w = world({ slackOffline: true });
    await w.assistant.handleMessage("u1", "where are we on acme?", inSales());
    expect(w.calls[0]?.tools).not.toContain("continue_in_dm");
    expect(w.calls[0]?.system).toContain("tell them to DM you");
  });

  it("the 'asker' policy gives a mention the asker's private tools", async () => {
    const w = world({ policy: "asker" });
    await w.assistant.handleMessage("u1", "where are we on acme?", inSales());
    expect(w.calls[0]?.tools).toContain("gmail_search");
    expect(w.calls[0]?.tools).not.toContain("continue_in_dm");
  });
});

describe("history: each conversation, filtered by who reads it", () => {
  it("Slack DMs and the web chat are one conversation", async () => {
    const w = world();
    await w.assistant.handleMessage("u1", "remember the number 42", dm);
    await w.assistant.handleMessage("u1", "what was the number?", web);
    expect(w.calls[1]?.history).toEqual(["remember the number 42", "answer to: remember the number 42"]);
  });

  it("a channel thread never loads the asker's DM history", async () => {
    const w = world();
    await w.assistant.handleMessage("u1", "my salary is 150k", dm);
    await w.assistant.handleMessage("u1", "recap please", inSales());
    expect(w.calls[1]?.history).toEqual([]);
    expect(w.calls[1]?.system).not.toContain("150k");
  });

  it("everyone asking in a thread shares its history", async () => {
    const w = world();
    await w.assistant.handleMessage("u1", "first question", inSales());
    await w.assistant.handleMessage("u2", "follow-up", inSales());
    expect(w.calls[1]?.history[0]).toContain("first question");
  });

  it("under the 'asker' policy, one person's private turn in a thread is hidden from the next asker", async () => {
    const w = world({ policy: "asker", memberships: { U1: ["CSALES"], U2: ["CSALES"] } });
    await w.assistant.handleMessage("u1", "private-ish question", inSales());
    await w.assistant.handleMessage("u2", "what did they ask?", inSales());
    expect(w.calls[1]?.history).toEqual([]);
    // …but the first asker still sees their own turn next time.
    await w.assistant.handleMessage("u1", "and?", inSales());
    expect(w.calls[2]?.history[0]).toContain("private-ish question");
  });

  it("history never starts on a tool result whose call was cut off", async () => {
    const w = world();
    w.plan.push({ withToolRoundTrip: true });
    await w.assistant.handleMessage("u1", "use a tool", dm);
    // 4 messages stored: user, tool-call, tool-result, answer. Force a cut right after the call.
    const rows = await w.conversations.recentInThread("direct:u1", 10);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    await w.conversations.append(
      Array.from({ length: 38 }, (_, i) => ({ ...rows[3]!, turnId: `pad${i}`, text: `pad ${i}` })),
    );
    // 42 rows; the model sees 40 → would start at the tool result without the fix.
    await w.assistant.handleMessage("u1", "next", dm);
    expect(w.calls[1]?.history[0]).not.toBe("<tool>");
  });

  it("reset clears the person's DM conversation only", async () => {
    const w = world();
    await w.assistant.handleMessage("u1", "dm thing", dm);
    await w.assistant.handleMessage("u1", "channel thing", inSales());
    expect(await w.assistant.reset("u1")).toBe(true);
    expect(await w.conversations.recentInThread("direct:u1", 10)).toEqual([]);
    expect(await w.conversations.recentInThread("channel:CSALES:100.0", 10)).toHaveLength(2);
  });
});

describe("recall: continuity across conversations, one direction only", () => {
  it("a DM remembers a channel thread the person is in", async () => {
    const w = world({ memberships: { U1: ["CSALES"] } });
    await w.assistant.handleMessage("u1", "where are we on acme?", inSales());
    await w.assistant.handleMessage("u1", "what did we say about acme earlier?", dm);
    expect(w.calls[1]?.system).toContain("Earlier, elsewhere");
    expect(w.calls[1]?.system).toContain("<#CSALES>");
    expect(w.calls[1]?.system).toContain("where are we on acme?");
  });

  it("…but not once they've left the channel", async () => {
    const w = world({ memberships: { U1: [] } });
    await w.assistant.handleMessage("u1", "where are we on acme?", inSales());
    await w.assistant.handleMessage("u1", "what did we say about acme?", dm);
    expect(w.calls[1]?.system).not.toContain("Earlier, elsewhere");
  });

  it("a channel never recalls the person's DMs", async () => {
    const w = world({ memberships: { U1: ["CSALES"] } });
    await w.assistant.handleMessage("u1", "the acme price floor is 80k", dm);
    await w.assistant.handleMessage("u1", "what's our floor?", inSales());
    expect(w.calls[1]?.system).not.toContain("80k");
  });

  it("a channel may recall another thread in the same channel, never another channel's", async () => {
    const w = world({ memberships: { U1: ["CSALES", "CENG"] } });
    await w.assistant.handleMessage("u1", "sales thread one", inSales("1.0"));
    await w.assistant.handleMessage("u1", "eng secret", { kind: "channel", channelId: "CENG", threadTs: "5.0" });
    await w.assistant.handleMessage("u1", "sales thread two", inSales("2.0"));
    expect(w.calls[2]?.system).toContain("sales thread one");
    expect(w.calls[2]?.system).not.toContain("eng secret");
  });

  it("a shared channel with outsiders doesn't recall internal-sourced threads, even in the same channel", async () => {
    const w = world({ memberships: { U1: ["CSALES"] } });
    await w.assistant.handleMessage("u1", "internal-sourced answer", inSales("1.0"));
    // The channel is now shared with another company.
    const shared = world({ outsidersIn: ["CSALES"], memberships: { U1: ["CSALES"] } });
    await shared.conversations.append(await w.conversations.recentInThread("channel:CSALES:1.0", 10));
    await shared.assistant.handleMessage("u1", "hello partners", inSales("2.0"));
    expect(shared.calls[0]?.system).not.toContain("internal-sourced answer");
  });
});

describe("continue in DM", () => {
  it("answers the private part in the asker's DM, with the question word for word", async () => {
    const w = world({ memberships: { U1: ["CSALES"] } });
    w.plan.push({ callContinueInDm: 1, reply: "public part; sent the rest to your DMs" });
    w.plan.push({ reply: "the private details" });

    const channelReply = await w.assistant.handleMessage("u1", "what did sarah say about acme?", inSales());
    await w.settle();

    expect(channelReply).toBe("public part; sent the rest to your DMs");
    const dmCall = w.calls[1];
    expect(dmCall?.tools).toContain("gmail_search");
    expect(dmCall?.userText.startsWith("what did sarah say about acme?")).toBe(true);
    expect(dmCall?.userText).not.toContain("acme renewal is due friday"); // no channel text re-injected as the question
    expect(dmCall?.system).toContain("<#CSALES>"); // it remembers the channel thread it came from
    expect(w.sent).toEqual([{ userId: "u1", text: expect.stringContaining("the private details") }]);
  });

  it("the private answer never comes back into the channel conversation", async () => {
    const w = world({ memberships: { U1: ["CSALES"] } });
    w.plan.push({ callContinueInDm: 1 });
    w.plan.push({ reply: "SECRET private answer" });
    await w.assistant.handleMessage("u1", "question", inSales());
    await w.settle();
    await w.assistant.handleMessage("u2", "anything else?", inSales());
    const later = w.calls[2];
    expect(JSON.stringify(later)).not.toContain("SECRET");
  });

  it("calling it twice in one reply sends one DM", async () => {
    const w = world();
    w.plan.push({ callContinueInDm: 2 });
    await w.assistant.handleMessage("u1", "question", inSales());
    await w.settle();
    expect(w.sent).toHaveLength(1);
    expect(w.calls).toHaveLength(2); // the channel reply + one DM reply
  });

  it("a failed DM send doesn't break the channel reply", async () => {
    const w = world({ messengerFails: true });
    w.plan.push({ callContinueInDm: 1, reply: "public" });
    const reply = await w.assistant.handleMessage("u1", "question", inSales());
    await w.settle();
    expect(reply).toBe("public");
    expect(w.sent).toEqual([]);
  });
});

describe("labels written to the log", () => {
  it("DM turns are the person's; channel turns are the channel's, insiders-only when internal sources were used", async () => {
    const w = world();
    await w.assistant.handleMessage("u1", "dm", dm);
    await w.assistant.handleMessage("u1", "channel", inSales());
    const [dmRow] = await w.conversations.recentInThread("direct:u1", 1);
    const [chRow] = await w.conversations.recentInThread("channel:CSALES:100.0", 1);
    expect(dmRow?.whoCanSee).toEqual(onlyUser("u1"));
    expect(chRow?.whoCanSee).toEqual({ kind: "membersOfChannel", channelId: "CSALES", insidersOnly: true });
  });

  it("a turn in a channel with outsiders is visible to that channel's readers next time", async () => {
    const w = world({ outsidersIn: ["CSALES"] });
    await w.assistant.handleMessage("u1", "hello partners", inSales());
    await w.assistant.handleMessage("u2", "and again", inSales());
    expect(w.calls[1]?.history[0]).toContain("hello partners");
  });
});
