import { webApi } from "@slack/bolt";
import type { AppLogger } from "../../slack/app.js";
import type { PrivacyConversation } from "../types.js";
import type { DMSample, MessagingPort } from "../ports.js";
import type { SlackCreds } from "./credentials.js";

export function createSlackMessagingAdapter(deps: {
  resolveCreds: (userId: string) => Promise<SlackCreds | null>;
  logger: AppLogger;
}): MessagingPort {
  const { resolveCreds, logger } = deps;

  return {
    async getDMs(userId: string): Promise<PrivacyConversation[]> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];

      try {
        const client = new webApi.WebClient(creds.userToken);
        const conversations: PrivacyConversation[] = [];

        let cursor: string | undefined;
        do {
          const res = await client.conversations.list({
            types: "im,mpim",
            limit: 200,
            exclude_archived: true,
            cursor,
          });

          for (const ch of (res.channels ?? []) as Array<Record<string, unknown>>) {
            const channelId = ch.id as string;
            if (!channelId) continue;

            const dmUserId = ch.user as string | undefined;
            let participantName: string | undefined;
            if (dmUserId) {
              try {
                const info = await client.users.info({ user: dmUserId });
                participantName = (info.user as Record<string, unknown>)?.real_name as string | undefined;
              } catch {
                // best-effort
              }
            }

            conversations.push({
              id: channelId,
              participantId: dmUserId,
              participantName,
              itemCount: 0,
            });
          }

          cursor = res.response_metadata?.next_cursor || undefined;
        } while (cursor);

        return conversations;
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "privacy: failed to fetch messaging DMs");
        return [];
      }
    },

    async getDMSamples(userId: string, conversationIds: string[], opts?: { maxPerConversation?: number }): Promise<DMSample[]> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];
      const maxPer = opts?.maxPerConversation ?? 3;

      try {
        const client = new webApi.WebClient(creds.userToken);
        const results: DMSample[] = [];

        for (const channelId of conversationIds.slice(0, 50)) {
          try {
            const history = await client.conversations.history({ channel: channelId, limit: maxPer });
            const messages = ((history.messages ?? []) as Array<Record<string, unknown>>)
              .map((m) => (m.text as string) ?? "")
              .filter(Boolean)
              .map((t) => t.length > 120 ? `${t.slice(0, 120)}…` : t);
            results.push({ id: channelId, messages });
          } catch {
            results.push({ id: channelId, messages: [] });
          }
        }
        return results;
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "privacy: failed to fetch DM samples");
        return [];
      }
    },
  };
}
