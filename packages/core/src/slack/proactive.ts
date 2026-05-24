import type { App } from "@slack/bolt";
import type { IdentityStore } from "../identity/store.js";
import type { AppLogger } from "./app.js";

export function createProactiveDm(
  app: App,
  identities: IdentityStore,
  logger: AppLogger,
): (tinoUserId: string, text: string) => Promise<void> {
  const channelCache = new Map<string, string>();

  return async (tinoUserId: string, text: string) => {
    let channelId = channelCache.get(tinoUserId);
    if (!channelId) {
      const linked = await identities.listForUser(tinoUserId);
      const slackIdentity = linked.find((i) => i.provider === "slack");
      if (!slackIdentity) {
        logger.warn({ tinoUserId }, "cannot send proactive DM — no linked Slack identity");
        return;
      }
      const openRes = await app.client.conversations.open({ users: slackIdentity.externalId });
      channelId = openRes.channel?.id;
      if (!channelId) {
        logger.error({ tinoUserId, slackUserId: slackIdentity.externalId }, "could not resolve DM channel");
        return;
      }
      channelCache.set(tinoUserId, channelId);
      logger.info({ tinoUserId, channelId }, "proactive DM channel resolved");
    }

    await app.client.chat.postMessage({ channel: channelId, text });
  };
}
