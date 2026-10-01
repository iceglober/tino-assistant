/**
 * Per-user Slack tools that run with the *user's* OAuth token (xoxp), granted
 * via the Slack connect flow. These read the user's own private messages — DMs,
 * group DMs, private + public channels, and cross-message search — which the bot
 * token cannot see. Each user's token is theirs alone.
 */
import type { webApi } from "@slack/bolt";
import { tool } from "ai";
import { z } from "zod";
import { toSlackTs } from "./time.js";

function slackError(err: unknown): { error: string; message: string } {
  const e = err as { data?: { error?: string }; message?: string };
  const code = e.data?.error ?? e.message ?? "unknown";
  if (code === "not_authed" || code === "invalid_auth" || code === "token_revoked") {
    return { error: "auth_error", message: `Slack auth failed (${code}). The user may need to reconnect Slack.` };
  }
  if (code === "missing_scope") {
    return { error: "missing_scope", message: "The user's Slack token is missing a required scope; reconnect Slack." };
  }
  return { error: "slack_error", message: `Slack API error: ${code}` };
}

const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Slack search query (same syntax as the Slack search box, e.g. 'from:@alice invoice')."),
  count: z.number().int().min(1).max(50).default(20).describe("Max matches to return (1–50, default 20)."),
  after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Only messages after this date (YYYY-MM-DD). Use for 'recently', 'this month', 'since June'."),
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Only messages before this date (YYYY-MM-DD)."),
  sort: z
    .enum(["score", "timestamp"])
    .default("score")
    .describe(
      "'timestamp' = newest first. USE 'timestamp' for questions about the user's recent or current state — " +
        "'score' is relevance-ranked with NO recency weighting and often surfaces months-old messages.",
    ),
  sortDir: z
    .enum(["desc", "asc"])
    .default("desc")
    .describe("Sort direction (with sort='timestamp', desc = newest first)."),
});

const historySchema = z.object({
  channel: z
    .string()
    .min(1)
    .describe("Conversation/DM ID (e.g. D01ABC123 or C01ABC123). Use slack_list_my_conversations to find it."),
  limit: z.number().int().min(1).max(50).default(20).describe("Max messages to return (1–50, default 20)."),
  oldest: z
    .string()
    .optional()
    .describe("Only messages after this time — Slack ts ('1753372800.000000') or ISO date ('2026-07-01')."),
  latest: z.string().optional().describe("Only messages before this time (same formats)."),
});

const threadSchema = z.object({
  channel: z
    .string()
    .min(1)
    .describe("Conversation/DM ID the thread lives in (e.g. D01ABC123). From slack_search_my_messages `channelId`."),
  ts: z
    .string()
    .min(1)
    .describe(
      "Timestamp of any message in the thread (the `ts` from a search match) — Slack returns the whole thread.",
    ),
  limit: z.number().int().min(1).max(100).default(50).describe("Max replies to return (1–100, default 50)."),
});

const listSchema = z.object({
  types: z
    .string()
    .default("im,mpim,private_channel,public_channel")
    .describe("Comma-separated conversation types: im, mpim, private_channel, public_channel."),
  limit: z.number().int().min(1).max(100).default(50).describe("Max conversations to return (1–100, default 50)."),
});

/** Search across the user's own messages (DMs, channels) with their token. */
export function slackSearchMyMessagesTool(client: webApi.WebClient) {
  return tool({
    description:
      "Search the CURRENT USER's own Slack messages — including their private DMs and group DMs — using Slack search syntax. " +
      "Returns matching messages with text, author, channel, and a permalink. " +
      "Default ranking is relevance with NO recency weighting: for anything about the user's recent/current state, " +
      "pass sort='timestamp' and/or an after: date.",
    inputSchema: searchSchema,
    execute: async ({ query, count, after, before, sort, sortDir }) => {
      try {
        const q = [query, after && `after:${after}`, before && `before:${before}`].filter(Boolean).join(" ");
        const res = await client.search.messages({ query: q, count, sort, sort_dir: sortDir });
        const matches = (res.messages?.matches ?? []).map((m) => ({
          text: m.text,
          user: m.username ?? m.user,
          // channelId is what slack_read_my_thread / slack_read_my_conversation need;
          // channelName is often empty for DMs, so never collapse the two.
          channelId: m.channel?.id,
          channelName: m.channel?.name,
          ts: m.ts,
          permalink: m.permalink,
        }));
        return { matches, total: res.messages?.total ?? matches.length };
      } catch (err) {
        return slackError(err);
      }
    },
  });
}

/** Read recent messages from one of the user's conversations/DMs with their token. */
export function slackReadMyConversationTool(client: webApi.WebClient) {
  return tool({
    description:
      "Read recent messages from one of the CURRENT USER's conversations — a DM, group DM, or channel they belong to — by its ID.",
    inputSchema: historySchema,
    execute: async ({ channel, limit, oldest, latest }) => {
      try {
        const res = await client.conversations.history({
          channel,
          limit,
          oldest: toSlackTs(oldest),
          latest: toSlackTs(latest),
        });
        const messages = (res.messages ?? []).map((m) => ({ user: m.user, text: m.text, ts: m.ts }));
        return { messages };
      } catch (err) {
        return slackError(err);
      }
    },
  });
}

/**
 * Read a full thread the user can see — including in a private DM, which the bot
 * token can never reach. Slack returns the whole thread for any `ts` in it.
 */
export function slackReadMyThreadTool(client: webApi.WebClient) {
  return tool({
    description:
      "Read all replies in a thread from one of the CURRENT USER's conversations, including private DMs and group DMs. " +
      "Pass the conversation id and the timestamp of any message in the thread (e.g. a slack_search_my_messages hit) " +
      "to get the full back-and-forth.",
    inputSchema: threadSchema,
    execute: async ({ channel, ts, limit }) => {
      try {
        const res = await client.conversations.replies({ channel, ts, limit });
        const messages = (res.messages ?? []).map((m) => ({
          user: m.user,
          text: m.text,
          ts: m.ts,
          threadTs: m.thread_ts,
        }));
        return { messages, hasMore: res.has_more ?? false };
      } catch (err) {
        return slackError(err);
      }
    },
  });
}

/** List the user's conversations (DMs, group DMs, channels) to discover IDs. */
export function slackListMyConversationsTool(client: webApi.WebClient) {
  return tool({
    description:
      "List the CURRENT USER's Slack conversations (DMs, group DMs, private + public channels) to find a conversation ID before reading it.",
    inputSchema: listSchema,
    execute: async ({ types, limit }) => {
      try {
        const res = await client.conversations.list({ types, limit });
        const conversations = (res.channels ?? []).map((ch) => ({
          id: ch.id,
          name: ch.name ?? (ch.is_im ? "(direct message)" : ch.is_mpim ? "(group dm)" : ch.id),
          kind: ch.is_im ? "im" : ch.is_mpim ? "mpim" : ch.is_private ? "private_channel" : "public_channel",
          withUser: ch.user,
        }));
        return { conversations };
      } catch (err) {
        return slackError(err);
      }
    },
  });
}
