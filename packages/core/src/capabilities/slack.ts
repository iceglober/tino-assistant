/**
 * Slack capability module.
 *
 * Registers slack_search_messages, slack_read_thread, slack_list_dms,
 * slack_read_dm tools. Uses the owner's user token (xoxp-) from credentials.
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
import type { CapabilityConfig, CapabilityModule } from "./types.js";

export const slackCapability: CapabilityModule = {
  id: "slack",
  displayName: "Slack",

  fieldSchema: [
    {
      key: "userToken",
      label: "User Token (xoxp-)",
      target: "credentials.userToken",
      secret: true,
      placeholder: "xoxp-...",
    },
  ],

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const userToken = config.credentials.userToken;
    if (!userToken) {
      throw new Error("Slack capability: credentials.userToken is not set");
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

    tools.slack_search_messages = slackSearchMessagesTool(userClient, userCache);
    tools.slack_read_thread = slackReadThreadTool(userClient, userCache);
    tools.slack_list_dms = slackListDmsTool(userClient, userCache);
    tools.slack_read_dm = slackReadDmTool(userClient, userCache);

    logger.info({ userCacheLoaded: !!userCache }, "slack reading tools enabled");
  },
};
