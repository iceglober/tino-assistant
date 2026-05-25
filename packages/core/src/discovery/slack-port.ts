/**
 * SlackDiscoveryPort — Slack data source for the discovery service.
 *
 * Uses the user's xoxp- token (from `slack-personal` capability) to fetch:
 * - Top DM partners by message count
 * - Active channels by message count
 * - A sample of the user's own messages (for communication style analysis)
 */
import { webApi } from "@slack/bolt";
import type { SlackCreds } from "../privacy/adapters/credentials.js";
import type { AppLogger } from "../slack/app.js";

export interface SlackDiscoveryPort {
  getTopDMPartners(
    userId: string,
    opts?: { sinceDays?: number; limit?: number },
  ): Promise<Array<{ name: string; messageCount: number }>>;

  getActiveChannels(
    userId: string,
    opts?: { sinceDays?: number; limit?: number },
  ): Promise<Array<{ name: string; messageCount: number }>>;

  getMessageSample(
    userId: string,
    opts?: { limit?: number },
  ): Promise<Array<{ channel: string; text: string; ts: string }>>;
}

export function createSlackDiscoveryPort(deps: {
  resolveCreds: (userId: string) => Promise<SlackCreds | null>;
  logger: AppLogger;
}): SlackDiscoveryPort {
  const { resolveCreds, logger } = deps;

  return {
    async getTopDMPartners(
      userId: string,
      opts?: { sinceDays?: number; limit?: number },
    ): Promise<Array<{ name: string; messageCount: number }>> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];

      const limit = opts?.limit ?? 20;
      const sinceDays = opts?.sinceDays ?? 180;
      const oldest = String(Math.floor((Date.now() - sinceDays * 86400 * 1000) / 1000));

      try {
        const client = new webApi.WebClient(creds.userToken);
        const partnerCounts = new Map<string, { name: string; count: number }>();

        let cursor: string | undefined;
        do {
          const res = await client.conversations.list({
            types: "im",
            limit: 200,
            exclude_archived: true,
            cursor,
          });

          for (const ch of (res.channels ?? []) as Array<Record<string, unknown>>) {
            const channelId = ch.id as string;
            if (!channelId) continue;

            const dmUserId = ch.user as string | undefined;
            if (!dmUserId) continue;

            // Get display name
            let name = dmUserId;
            try {
              const info = await client.users.info({ user: dmUserId });
              const user = info.user as Record<string, unknown> | undefined;
              name = (user?.real_name as string) ?? (user?.name as string) ?? dmUserId;
            } catch {
              // best-effort
            }

            // Count messages in this DM
            try {
              const history = await client.conversations.history({
                channel: channelId,
                oldest,
                limit: 200,
              });
              const count = (history.messages ?? []).length;
              if (count > 0) {
                partnerCounts.set(dmUserId, { name, count });
              }
            } catch {
              // skip channels we can't read
            }
          }

          cursor = res.response_metadata?.next_cursor || undefined;
        } while (cursor);

        return [...partnerCounts.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, limit)
          .map(({ name, count }) => ({ name, messageCount: count }));
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "discovery: failed to fetch Slack DM partners");
        return [];
      }
    },

    async getActiveChannels(
      userId: string,
      opts?: { sinceDays?: number; limit?: number },
    ): Promise<Array<{ name: string; messageCount: number }>> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];

      const limit = opts?.limit ?? 20;
      const sinceDays = opts?.sinceDays ?? 180;
      const oldest = String(Math.floor((Date.now() - sinceDays * 86400 * 1000) / 1000));

      try {
        const client = new webApi.WebClient(creds.userToken);
        const channelCounts: Array<{ name: string; messageCount: number }> = [];

        // Get channels the user is a member of
        let cursor: string | undefined;
        do {
          const res = await client.users.conversations({
            types: "public_channel,private_channel",
            limit: 200,
            exclude_archived: true,
            cursor,
          });

          for (const ch of (res.channels ?? []) as Array<Record<string, unknown>>) {
            const channelId = ch.id as string;
            const channelName = (ch.name as string) ?? channelId;
            if (!channelId) continue;

            try {
              const history = await client.conversations.history({
                channel: channelId,
                oldest,
                limit: 200,
              });
              const count = (history.messages ?? []).length;
              if (count > 0) {
                channelCounts.push({ name: `#${channelName}`, messageCount: count });
              }
            } catch {
              // skip channels we can't read
            }
          }

          cursor = res.response_metadata?.next_cursor || undefined;
        } while (cursor);

        return channelCounts.sort((a, b) => b.messageCount - a.messageCount).slice(0, limit);
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "discovery: failed to fetch Slack active channels");
        return [];
      }
    },

    async getMessageSample(
      userId: string,
      opts?: { limit?: number },
    ): Promise<Array<{ channel: string; text: string; ts: string }>> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];

      const limit = opts?.limit ?? 20;

      try {
        const client = new webApi.WebClient(creds.userToken);

        // Use search.messages to find the user's own messages
        const res = await client.search.messages({
          query: "from:me",
          count: limit,
          sort: "timestamp",
          sort_dir: "desc",
        });

        const matches = (res.messages as Record<string, unknown> | undefined)?.matches as
          | Array<Record<string, unknown>>
          | undefined;
        if (!matches) return [];

        return matches
          .map((m) => ({
            channel: ((m.channel as Record<string, unknown>)?.name as string) ?? "unknown",
            text: (m.text as string) ?? "",
            ts: (m.ts as string) ?? "",
          }))
          .filter((m) => m.text.length > 0)
          .slice(0, limit);
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "discovery: failed to fetch Slack message sample");
        return [];
      }
    },
  };
}
