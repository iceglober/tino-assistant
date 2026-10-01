import type { webApi } from "@slack/bolt";
import { tool } from "ai";
import { z } from "zod";
import { toSlackTs } from "./time.js";
import type { UserCache } from "./user-cache.js";

const listChannelsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe("Max channels to return (1–100, default 20)"),
});

const readChannelSchema = z.object({
  channel: z.string().min(1).describe("Channel ID (e.g., C01ABC123)"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max messages to return (1–50, default 20)"),
  oldest: z.string().optional().describe("Only messages after this time — Slack ts or ISO date ('2026-07-01')."),
  latest: z.string().optional().describe("Only messages before this time (same formats)."),
});

const readThreadSchema = z.object({
  channel: z.string().min(1).describe("Channel ID (e.g., C01ABC123)"),
  threadTs: z.string().min(1).describe("Thread parent message timestamp"),
  limit: z.number().int().min(1).max(100).default(20).describe("Max replies to return (1–100, default 20)"),
});

interface ChannelInfo {
  id: string;
  name: string;
  topic: string;
  purpose: string;
  memberCount: number;
}

interface ChannelMessage {
  user: string;
  userName: string;
  text: string;
  ts: string;
  threadTs?: string;
  replyCount?: number;
}

/**
 * Which channels the bot-token tools may read. The bot token can read every
 * channel the bot was invited to, private ones included, but the person asking
 * may not be a member — so the general tools stick to public channels. The
 * channel tino was asked in is read through the `this channel` tools instead.
 * Private content a user can see is reachable through their own token.
 */
export type ChannelGuard = (channelId: string) => Promise<boolean>;

export function publicChannelGuard(client: webApi.WebClient): ChannelGuard {
  const cache = new Map<string, boolean>();
  return async (channelId) => {
    const cached = cache.get(channelId);
    if (cached !== undefined) return cached;
    try {
      const res = await client.conversations.info({ channel: channelId });
      const ch = res.channel as { is_private?: boolean; is_im?: boolean; is_mpim?: boolean } | undefined;
      const ok = !!ch && !ch.is_private && !ch.is_im && !ch.is_mpim;
      cache.set(channelId, ok);
      return ok;
    } catch {
      return false;
    }
  };
}

const NOT_PUBLIC = {
  error: "not_public",
  message:
    "That isn't a public channel. These tools only read public channels; use slack_read_this_channel for the channel " +
    "you were asked in, and the user's own Slack tools for private conversations they belong to.",
};

function handleSlackError(err: unknown): { error: string; message: string } {
  const e = err as { data?: { error?: string }; message?: string };
  const slackError = e.data?.error ?? e.message ?? "unknown";
  if (slackError === "not_authed" || slackError === "invalid_auth" || slackError === "token_revoked") {
    return { error: "auth_error", message: `Slack auth failed: ${slackError}` };
  }
  if (slackError === "channel_not_found") {
    return { error: "channel_not_found", message: "Channel not found or the bot is not a member." };
  }
  if (slackError === "missing_scope") {
    return { error: "missing_scope", message: `Bot token missing required scope: ${slackError}` };
  }
  return { error: "slack_error", message: `Slack API error: ${slackError}` };
}

export function slackListChannelsTool(client: webApi.WebClient) {
  return tool({
    description:
      "List public Slack channels the bot is a member of. " +
      "Returns channel ID, name, topic, and member count. " +
      "Use this to find the right channel ID before calling slack_read_channel.",
    inputSchema: listChannelsSchema,
    execute: async (input) => {
      try {
        const res = await client.conversations.list({
          types: "public_channel",
          exclude_archived: true,
          limit: input.limit,
        });
        const channels: ChannelInfo[] = ((res.channels ?? []) as Array<Record<string, unknown>>).map((ch) => ({
          id: (ch.id as string) ?? "",
          name: (ch.name as string) ?? "",
          topic: ((ch.topic as { value?: string })?.value ?? ""),
          purpose: ((ch.purpose as { value?: string })?.value ?? ""),
          memberCount: (ch.num_members as number) ?? 0,
        }));
        return { channels, count: channels.length };
      } catch (err) {
        return handleSlackError(err);
      }
    },
  });
}

async function readHistory(
  client: webApi.WebClient,
  channel: string,
  input: { limit: number; oldest?: string; latest?: string },
  userCache?: UserCache,
) {
  try {
    const res = await client.conversations.history({
      channel,
      limit: input.limit,
      oldest: toSlackTs(input.oldest),
      latest: toSlackTs(input.latest),
    });
    const messages: ChannelMessage[] = await Promise.all(
      (res.messages ?? []).map(async (m) => {
        const userId = (m as { user?: string }).user ?? "";
        const userName = userId && userCache ? (await userCache.resolve(userId)).name : userId;
        return {
          user: userId,
          userName,
          text: (m as { text?: string }).text ?? "",
          ts: (m as { ts?: string }).ts ?? "",
          threadTs: (m as { thread_ts?: string }).thread_ts,
          replyCount: (m as { reply_count?: number }).reply_count,
        };
      }),
    );
    return { messages, count: messages.length, hasMore: res.has_more ?? false };
  } catch (err) {
    return handleSlackError(err);
  }
}

async function readReplies(
  client: webApi.WebClient,
  channel: string,
  input: { threadTs: string; limit: number },
  userCache?: UserCache,
) {
  try {
    const res = await client.conversations.replies({ channel, ts: input.threadTs, limit: input.limit, inclusive: true });
    const messages: ChannelMessage[] = await Promise.all(
      (res.messages ?? []).map(async (m) => {
        const userId = (m as { user?: string }).user ?? "";
        const userName = userId && userCache ? (await userCache.resolve(userId)).name : userId;
        return {
          user: userId,
          userName,
          text: (m as { text?: string }).text ?? "",
          ts: (m as { ts?: string }).ts ?? "",
        };
      }),
    );
    return { messages, count: messages.length, hasMore: res.has_more ?? false };
  } catch (err) {
    return handleSlackError(err);
  }
}

export function slackReadChannelTool(client: webApi.WebClient, allowed: ChannelGuard, userCache?: UserCache) {
  return tool({
    description:
      "Read recent messages from a public Slack channel. " +
      "Get the channel ID from slack_list_channels. " +
      'Use for "what\'s happening in #engineering?", "catch me up on #general", etc.',
    inputSchema: readChannelSchema,
    execute: async (input) =>
      (await allowed(input.channel)) ? readHistory(client, input.channel, input, userCache) : NOT_PUBLIC,
  });
}

export function slackReadChannelThreadTool(client: webApi.WebClient, allowed: ChannelGuard, userCache?: UserCache) {
  return tool({
    description:
      "Read a thread in a public Slack channel (all replies to a message). " +
      "Requires the channel ID and parent message timestamp from slack_read_channel results.",
    inputSchema: readThreadSchema,
    execute: async (input) =>
      (await allowed(input.channel)) ? readReplies(client, input.channel, input, userCache) : NOT_PUBLIC,
  });
}

/** Reads further back in the channel tino was asked in. The channel is fixed; the model can't choose another. */
export function slackReadThisChannelTool(client: webApi.WebClient, channelId: string, userCache?: UserCache) {
  return tool({
    description:
      "Read earlier messages in the channel you were asked in (beyond the recent messages you already have).",
    inputSchema: readChannelSchema.omit({ channel: true }),
    execute: (input) => readHistory(client, channelId, input, userCache),
  });
}

/** Reads a thread in the channel tino was asked in. */
export function slackReadThisThreadTool(client: webApi.WebClient, channelId: string, userCache?: UserCache) {
  return tool({
    description: "Read a whole thread in the channel you were asked in, given its parent message timestamp.",
    inputSchema: readThreadSchema.omit({ channel: true }),
    execute: (input) => readReplies(client, channelId, input, userCache),
  });
}
