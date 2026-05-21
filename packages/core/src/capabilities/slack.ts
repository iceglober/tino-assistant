/**
 * Slack capability module — shared, centrally-configured.
 *
 * Provides public-channel tools using the bot token (xoxb-) that's already
 * configured in core config (slack.botToken). Available to all users.
 *
 * Tools: slack_list_channels, slack_read_channel, slack_read_channel_thread
 */

import { webApi } from "@slack/bolt";
import type { ToolSet } from "ai";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { createUserCache } from "../slack/userCache.js";
import { slackListChannelsTool, slackReadChannelTool, slackReadChannelThreadTool } from "../tools/slack/channels.js";
import type { CapabilityConfig, SharedCapability } from "./types.js";

export const slackCapability: SharedCapability = {
  id: "slack",
  displayName: "Slack",
  scope: "shared",

  fieldSchema: [],

  async registerTools(
    _config: CapabilityConfig,
    configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const raw = await configStore.get("slack.botToken");
    if (!raw) {
      logger.debug("slack capability: no bot token in config store, skipping");
      return;
    }

    let botToken: string;
    try {
      botToken = JSON.parse(raw) as string;
    } catch {
      botToken = raw;
    }

    if (!botToken || !botToken.startsWith("xoxb-")) {
      logger.debug("slack capability: bot token missing or invalid, skipping");
      return;
    }

    const client = new webApi.WebClient(botToken);

    let userCache: Awaited<ReturnType<typeof createUserCache>> | undefined;
    try {
      userCache = await createUserCache(client, logger);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "slack user cache failed to load");
    }

    tools.slack_list_channels = slackListChannelsTool(client);
    tools.slack_read_channel = slackReadChannelTool(client, userCache);
    tools.slack_read_channel_thread = slackReadChannelThreadTool(client, userCache);

    logger.info("slack shared tools enabled (3 channel tools)");
  },
};
