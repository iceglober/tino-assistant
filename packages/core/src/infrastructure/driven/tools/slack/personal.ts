/**
 * Per-user Slack tools that run with the *user's* OAuth token (xoxp), granted
 * via the Slack connect flow. These read the user's own private messages — DMs,
 * group DMs, private + public channels, and cross-message search — which the bot
 * token cannot see. Each user's token is theirs alone.
 */
import type { webApi } from "@slack/bolt";
import { tool } from "ai";
import { z } from "zod";

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
  query: z.string().min(1).describe("Slack search query (same syntax as the Slack search box, e.g. 'from:@alice invoice')."),
  count: z.number().int().min(1).max(50).default(20).describe("Max matches to return (1–50, default 20)."),
});

const historySchema = z.object({
  channel: z.string().min(1).describe("Conversation/DM ID (e.g. D01ABC123 or C01ABC123). Use slack_list_my_conversations to find it."),
  limit: z.number().int().min(1).max(50).default(20).describe("Max messages to return (1–50, default 20)."),
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
      "Returns matching messages with text, author, channel, and a permalink.",
    inputSchema: searchSchema,
    execute: async ({ query, count }) => {
      try {
        const res = await client.search.messages({ query, count });
        const matches = (res.messages?.matches ?? []).map((m) => ({
          text: m.text,
          user: m.username ?? m.user,
          channel: m.channel?.name ?? m.channel?.id,
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
    execute: async ({ channel, limit }) => {
      try {
        const res = await client.conversations.history({ channel, limit });
        const messages = (res.messages ?? []).map((m) => ({ user: m.user, text: m.text, ts: m.ts }));
        return { messages };
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
