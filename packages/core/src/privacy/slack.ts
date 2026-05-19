import type { Decision, SlackPrivacyConfig } from "./types.js";

interface SlackDmResult {
  conversations?: Array<{ channelId: string; userId?: string; isGroup?: boolean }>;
  messages?: Array<{ user: string; ts?: string }>;
  channelId?: string;
  error?: string;
}

export function slackFilter(
  toolArgs: unknown,
  toolResult: unknown,
  config: SlackPrivacyConfig | undefined,
): Decision {
  const result = toolResult as SlackDmResult;
  if (result.error) return { persist: true };
  if (!config) return { persist: true };

  const denyConvos = new Set(config.denyListedConversationIds);
  const denyUsers = new Set(config.denyListedUserIds);

  // slack_read_dm — single conversation
  const channelId = (toolArgs as { channel?: string })?.channel ?? result.channelId;
  if (channelId && denyConvos.has(channelId)) {
    return {
      persist: false,
      placeholder: {
        type: "redacted",
        reason: "deny_listed_dm",
        metadata: { channelId },
      },
    };
  }

  // Check participants in messages
  if (result.messages) {
    for (const msg of result.messages) {
      if (denyUsers.has(msg.user)) {
        return {
          persist: false,
          placeholder: {
            type: "redacted",
            reason: "deny_listed_dm",
            metadata: { channelId, ts: msg.ts },
          },
        };
      }
    }
  }

  // slack_list_dms — list of conversations
  if (result.conversations) {
    for (const convo of result.conversations) {
      if (denyConvos.has(convo.channelId)) {
        return {
          persist: false,
          placeholder: {
            type: "redacted",
            reason: "deny_listed_dm",
            metadata: { channelId: convo.channelId },
          },
        };
      }
      if (convo.userId && denyUsers.has(convo.userId)) {
        return {
          persist: false,
          placeholder: {
            type: "redacted",
            reason: "deny_listed_dm",
            metadata: { channelId: convo.channelId },
          },
        };
      }
    }
  }

  return { persist: true };
}
