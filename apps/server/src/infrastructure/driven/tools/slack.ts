/**
 * The bot-token Slack tools, in two groups the tool provider labels separately:
 *   - public channels: anyone in the workspace may see what they return
 *   - this channel: only the channel tino was asked in, locked to that channel
 * The client and user cache are set up once (the cache is a Slack API round
 * trip); the tools are cheap to make per reply.
 */
import { webApi } from "@slack/bolt";
import type { ToolSet } from "ai";
import type { ConfigStore, Logger } from "@tino/core/ports/outbound";
import {
  publicChannelGuard,
  slackListChannelsTool,
  slackReadChannelThreadTool,
  slackReadChannelTool,
  slackReadThisChannelTool,
  slackReadThisThreadTool,
} from "./slack/channels.js";
import { createUserCache } from "./slack/user-cache.js";

export interface SlackChannelTools {
  publicChannels(): ToolSet;
  thisChannel(channelId: string): ToolSet;
}

const NO_SLACK: SlackChannelTools = { publicChannels: () => ({}), thisChannel: () => ({}) };

export async function buildSlackTools(configStore: ConfigStore, logger: Logger): Promise<SlackChannelTools> {
  const raw = await configStore.get("slack.botToken");
  if (!raw) return NO_SLACK;
  let botToken: string;
  try {
    botToken = JSON.parse(raw) as string;
  } catch {
    botToken = raw;
  }
  if (!botToken.startsWith("xoxb-")) return NO_SLACK;

  const client = new webApi.WebClient(botToken);
  let userCache: Awaited<ReturnType<typeof createUserCache>> | undefined;
  try {
    userCache = await createUserCache(client, logger);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "slack user cache failed to load");
  }
  const onlyPublic = publicChannelGuard(client);
  return {
    publicChannels: () => ({
      slack_list_channels: slackListChannelsTool(client),
      slack_read_channel: slackReadChannelTool(client, onlyPublic, userCache),
      slack_read_channel_thread: slackReadChannelThreadTool(client, onlyPublic, userCache),
    }),
    thisChannel: (channelId) => ({
      slack_read_this_channel: slackReadThisChannelTool(client, channelId, userCache),
      slack_read_this_thread: slackReadThisThreadTool(client, channelId, userCache),
    }),
  };
}
