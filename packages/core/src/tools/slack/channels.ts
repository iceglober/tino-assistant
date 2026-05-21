import type { webApi } from "@slack/bolt";
import { tool } from "ai";
import { z } from "zod";
import type { UserCache } from "../../slack/userCache.js";

const listChannelsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe("Max channels to return (1–100, default 20)"),
});

const readChannelSchema = z.object({
  channel: z.string().min(1).describe("Channel ID (e.g., C01ABC123)"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max messages to return (1–50, default 20)"),
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

export function slackReadChannelTool(client: webApi.WebClient, userCache?: UserCache) {
  return tool({
    description:
      "Read recent messages from a public Slack channel. " +
      "Get the channel ID from slack_list_channels. " +
      'Use for "what\'s happening in #engineering?", "catch me up on #general", etc.',
    inputSchema: readChannelSchema,
    execute: async (input) => {
      try {
        const res = await client.conversations.history({
          channel: input.channel,
          limit: input.limit,
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
    },
  });
}

export function slackReadChannelThreadTool(client: webApi.WebClient, userCache?: UserCache) {
  return tool({
    description:
      "Read a thread in a public Slack channel (all replies to a message). " +
      "Requires the channel ID and parent message timestamp from slack_read_channel results.",
    inputSchema: readThreadSchema,
    execute: async (input) => {
      try {
        const res = await client.conversations.replies({
          channel: input.channel,
          ts: input.threadTs,
          limit: input.limit,
          inclusive: true,
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
            };
          }),
        );
        return { messages, count: messages.length, hasMore: res.has_more ?? false };
      } catch (err) {
        return handleSlackError(err);
      }
    },
  });
}
