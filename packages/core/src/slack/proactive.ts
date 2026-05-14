import type { App } from '@slack/bolt';
import type { AppLogger } from './app.js';

/**
 * Resolve the DM channel ID for the owner and return a function that posts
 * messages to it proactively (outside of an event handler).
 *
 * Uses conversations.open to find/create the DM channel, then chat.postMessage
 * to send. The bot already has chat:write scope.
 *
 * Call this once at startup after app.start(). The returned function can be
 * passed to startScheduler as `postResult`.
 */
export async function createProactiveDm(
  app: App,
  ownerUserId: string,
  logger: AppLogger,
): Promise<(text: string) => Promise<void>> {
  // Resolve DM channel — conversations.open creates the DM if it doesn't exist
  const openRes = await app.client.conversations.open({ users: ownerUserId });
  const channelId = openRes.channel?.id;
  if (!channelId) {
    throw new Error(`Could not resolve DM channel for user ${ownerUserId}`);
  }
  logger.info({ channelId }, 'proactive DM channel resolved');

  return async (text: string) => {
    await app.client.chat.postMessage({
      channel: channelId,
      text,
    });
  };
}
