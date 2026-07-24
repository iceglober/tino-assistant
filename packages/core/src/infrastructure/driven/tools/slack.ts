/**
 * Builds the shared Slack channel-read tools from the bot token. Called once at
 * startup (loading the user cache is a Slack API round-trip). Returns {} if no
 * bot token is configured.
 */
import { webApi } from "@slack/bolt";
import type { ToolSet } from "ai";
import type { ConfigStore, Logger } from "../../../ports/outbound.js";
import { slackListChannelsTool, slackReadChannelTool, slackReadChannelThreadTool } from "./slack/channels.js";
import { createUserCache } from "./slack/user-cache.js";

export async function buildSlackTools(configStore: ConfigStore, logger: Logger): Promise<ToolSet> {
  const raw = await configStore.get("slack.botToken");
  if (!raw) return {};
  let botToken: string;
  try {
    botToken = JSON.parse(raw) as string;
  } catch {
    botToken = raw;
  }
  if (!botToken.startsWith("xoxb-")) return {};

  const client = new webApi.WebClient(botToken);
  let userCache: Awaited<ReturnType<typeof createUserCache>> | undefined;
  try {
    userCache = await createUserCache(client, logger);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "slack user cache failed to load");
  }
  return {
    slack_list_channels: slackListChannelsTool(client),
    slack_read_channel: slackReadChannelTool(client, userCache),
    slack_read_channel_thread: slackReadChannelThreadTool(client, userCache),
  };
}
