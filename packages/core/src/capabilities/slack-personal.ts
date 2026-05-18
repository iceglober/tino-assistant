/**
 * Slack personal (xoxp-) capability module — private, per-user credentials.
 *
 * Builds slack_search_messages, slack_read_thread, slack_list_dms, slack_read_dm
 * tools when the user has configured their personal user token (xoxp-).
 * Returns null if credentials are missing/disabled.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */
import { webApi } from "@slack/bolt";
import type { ToolSet } from "ai";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { createUserCache } from "../slack/userCache.js";
import { slackListDmsTool, slackReadDmTool } from "../tools/slack/dms.js";
import { slackSearchMessagesTool } from "../tools/slack/search.js";
import { slackReadThreadTool } from "../tools/slack/thread.js";
import type { CapabilityConfig, PrivateCapability } from "./types.js";

export const slackPersonalCapability: PrivateCapability = {
  id: "slack-personal",
  displayName: "Slack (Personal)",
  scope: "private",

  fieldSchema: [
    {
      key: "userToken",
      label: "User Token (xoxp-)",
      target: "credentials.userToken",
      secret: true,
      placeholder: "xoxp-...",
    },
  ],

  async buildToolsForUser(
    _tinoUserId: string,
    config: CapabilityConfig | null,
    _configStore: ConfigStore,
    logger: AppLogger,
  ): Promise<ToolSet | null> {
    if (!config) {
      return null;
    }

    const userToken = config.credentials.userToken;
    if (!userToken) {
      return null;
    }

    const userClient = new webApi.WebClient(userToken);

    let userCache: Awaited<ReturnType<typeof createUserCache>> | undefined;
    try {
      userCache = await createUserCache(userClient, logger);
    } catch (cacheErr) {
      logger.warn(
        { err: (cacheErr as Error).message },
        "slack user cache failed to load — tools will use user IDs instead of display names",
      );
    }

    const tools: ToolSet = {
      slack_search_messages: slackSearchMessagesTool(userClient, userCache),
      slack_read_thread: slackReadThreadTool(userClient, userCache),
      slack_list_dms: slackListDmsTool(userClient, userCache),
      slack_read_dm: slackReadDmTool(userClient, userCache),
    };

    logger.info({ tinoUserId: _tinoUserId, userCacheLoaded: !!userCache }, "slack personal tools enabled");
    return tools;
  },
};
