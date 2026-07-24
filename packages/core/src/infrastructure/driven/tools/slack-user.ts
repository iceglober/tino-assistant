/**
 * Builds the per-user Slack tools from the user's stored OAuth token (xoxp),
 * granted via the connect flow. Returns {} if the user hasn't connected Slack.
 */
import { webApi } from "@slack/bolt";
import type { ToolSet } from "ai";
import type { ConfigStore, Logger, UserCapabilityStore } from "../../../ports/outbound.js";
import { readUserCredentials } from "./credentials.js";
import {
  slackListMyConversationsTool,
  slackReadMyConversationTool,
  slackReadMyThreadTool,
  slackSearchMyMessagesTool,
} from "./slack/personal.js";

export async function buildSlackUserTools(
  userId: string,
  configStore: ConfigStore,
  userCapabilities: UserCapabilityStore,
  logger: Logger,
): Promise<ToolSet> {
  const cfg = await readUserCredentials(userId, "slack", configStore, userCapabilities);
  const token = cfg?.credentials?.userToken;
  if (!token) return {};

  const client = new webApi.WebClient(token);
  logger.info({ userId }, "slack user tools enabled");
  return {
    slack_search_my_messages: slackSearchMyMessagesTool(client),
    slack_read_my_conversation: slackReadMyConversationTool(client),
    slack_read_my_thread: slackReadMyThreadTool(client),
    slack_list_my_conversations: slackListMyConversationsTool(client),
  };
}
