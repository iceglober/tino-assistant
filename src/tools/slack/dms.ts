import { tool } from 'ai';
import { z } from 'zod';
import { webApi } from '@slack/bolt';
import type { UserCache } from '../../slack/userCache.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listDmsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Max conversations to return (1–50, default 20)'),
  sinceIso: z
    .string()
    .optional()
    .describe(
      'ISO-8601 timestamp. When provided, paginate through ALL conversations and return only those ' +
      'with activity at or after this time. Use this to find "who did I DM today?". ' +
      'When omitted, returns the most recent `limit` conversations.',
    ),
});

const readDmInputSchema = z.object({
  channel: z
    .string()
    .min(1)
    .describe('DM channel ID (from slack_list_dms or slack_search_messages results)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Max messages to return (1–50, default 20)'),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ListDmsInput = z.infer<typeof listDmsInputSchema>;
type ReadDmInput = z.infer<typeof readDmInputSchema>;

interface DmConversation {
  channelId: string;
  userId?: string;
  userName?: string;
  isGroup: boolean;
  isConnect: boolean;
}

interface DmMessage {
  user: string;
  userName: string;
  text: string;
  ts: string;
}

type ListDmsResult =
  | { conversations: DmConversation[]; count: number }
  | { error: string; message: string };

type ReadDmResult =
  | { messages: DmMessage[]; count: number; hasMore: boolean }
  | { error: string; message: string };

// ---------------------------------------------------------------------------
// _executeListDms
// ---------------------------------------------------------------------------

export async function _executeListDms(
  client: webApi.WebClient,
  input: ListDmsInput,
  userCache?: UserCache,
): Promise<ListDmsResult> {
  try {
    const sinceEpoch = input.sinceIso ? new Date(input.sinceIso).getTime() / 1000 : undefined;
    const conversations: DmConversation[] = [];

    if (sinceEpoch !== undefined) {
      // Paginate through ALL conversations to find those with recent activity
      let cursor: string | undefined;
      do {
        const res = await client.conversations.list({
          types: 'im,mpim',
          limit: 200,
          exclude_archived: true,
          cursor,
        });

        const channels = res.channels ?? [];
        for (const ch of channels) {
          const updated = parseFloat((ch as { updated?: string | number }).updated as string ?? '0');
          if (updated < sinceEpoch) continue;

          const channelId = (ch as { id?: string }).id ?? '';
          const isGroup = (ch as { is_mpim?: boolean }).is_mpim === true;
          const isConnect =
            (ch as { is_ext_shared?: boolean }).is_ext_shared === true ||
            ((ch as { connected_team_ids?: string[] }).connected_team_ids?.length ?? 0) > 0;

          if (isGroup) {
            let memberNames: string[] = [];
            try {
              const membersRes = await client.conversations.members({ channel: channelId });
              const memberIds = (membersRes.members ?? []) as string[];
              memberNames = await Promise.all(
                memberIds.map(uid => userCache ? userCache.resolve(uid).then(u => u.name) : Promise.resolve(uid)),
              );
            } catch {
              // best-effort
            }
            conversations.push({
              channelId,
              isGroup: true,
              isConnect,
              userName: memberNames.length > 0 ? memberNames.join(', ') : undefined,
            });
          } else {
            const userId = (ch as { user?: string }).user;
            let userName: string | undefined;
            if (userId) {
              userName = userCache ? (await userCache.resolve(userId)).name : userId;
            }
            conversations.push({
              channelId,
              userId,
              userName,
              isGroup: false,
              isConnect,
            });
          }

          if (conversations.length >= input.limit) break;
        }

        cursor = (res.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;
        if (conversations.length >= input.limit) break;
      } while (cursor);
    } else {
      // Default: return the first `limit` conversations by most recent activity
      const res = await client.conversations.list({
        types: 'im,mpim',
        limit: input.limit,
        exclude_archived: true,
      });

      const channels = res.channels ?? [];

      for (const ch of channels) {
        const channelId = (ch as { id?: string }).id ?? '';
        const isGroup = (ch as { is_mpim?: boolean }).is_mpim === true;
        const isConnect =
          (ch as { is_ext_shared?: boolean }).is_ext_shared === true ||
          ((ch as { connected_team_ids?: string[] }).connected_team_ids?.length ?? 0) > 0;

        if (isGroup) {
          let memberNames: string[] = [];
          try {
            const membersRes = await client.conversations.members({ channel: channelId });
            const memberIds = (membersRes.members ?? []) as string[];
            memberNames = await Promise.all(
              memberIds.map(uid => userCache ? userCache.resolve(uid).then(u => u.name) : Promise.resolve(uid)),
            );
          } catch {
            // best-effort
          }
          conversations.push({
            channelId,
            isGroup: true,
            isConnect,
            userName: memberNames.length > 0 ? memberNames.join(', ') : undefined,
          });
        } else {
          const userId = (ch as { user?: string }).user;
          let userName: string | undefined;
          if (userId) {
            userName = userCache ? (await userCache.resolve(userId)).name : userId;
          }
          conversations.push({
            channelId,
            userId,
            userName,
            isGroup: false,
            isConnect,
          });
        }
      }
    }

    return { conversations, count: conversations.length };
  } catch (err: unknown) {
    const e = err as { data?: { error?: string }; message?: string };
    const slackError = e.data?.error ?? e.message ?? 'unknown';
    if (
      slackError === 'not_authed' ||
      slackError === 'invalid_auth' ||
      slackError === 'token_revoked'
    ) {
      return {
        error: 'auth_error',
        message: `Slack auth failed: ${slackError}. Check SLACK_USER_TOKEN.`,
      };
    }
    if (slackError === 'missing_scope') {
      return {
        error: 'missing_scope',
        message: 'SLACK_USER_TOKEN is missing the im:read or mpim:read scope.',
      };
    }
    return { error: 'slack_error', message: `Slack API error: ${slackError}` };
  }
}

// ---------------------------------------------------------------------------
// _executeReadDm
// ---------------------------------------------------------------------------

export async function _executeReadDm(
  client: webApi.WebClient,
  input: ReadDmInput,
  userCache?: UserCache,
): Promise<ReadDmResult> {
  try {
    const res = await client.conversations.history({
      channel: input.channel,
      limit: input.limit,
    });

    const rawMessages = res.messages ?? [];

    const messages: DmMessage[] = await Promise.all(
      rawMessages.map(async m => {
        const userId = (m as { user?: string }).user ?? '';
        const userName = userId ? userCache ? (await userCache.resolve(userId)).name : userId : '';
        return {
          user: userId,
          userName,
          text: (m as { text?: string }).text ?? '',
          ts: (m as { ts?: string }).ts ?? '',
        };
      }),
    );

    return {
      messages,
      count: messages.length,
      hasMore: res.has_more ?? false,
    };
  } catch (err: unknown) {
    const e = err as { data?: { error?: string }; message?: string };
    const slackError = e.data?.error ?? e.message ?? 'unknown';
    if (
      slackError === 'not_authed' ||
      slackError === 'invalid_auth' ||
      slackError === 'token_revoked'
    ) {
      return {
        error: 'auth_error',
        message: `Slack auth failed: ${slackError}. Check SLACK_USER_TOKEN.`,
      };
    }
    if (slackError === 'channel_not_found') {
      return {
        error: 'channel_not_found',
        message: `Channel ${input.channel} not found or you're not a member.`,
      };
    }
    if (slackError === 'missing_scope') {
      return {
        error: 'missing_scope',
        message: 'SLACK_USER_TOKEN is missing the im:history or mpim:history scope.',
      };
    }
    return { error: 'slack_error', message: `Slack API error: ${slackError}` };
  }
}

// ---------------------------------------------------------------------------
// Tool exports
// ---------------------------------------------------------------------------

export function slackListDmsTool(client: webApi.WebClient, userCache?: UserCache) {
  return tool({
    description:
      'List your recent DM conversations (1:1 and group, including Slack Connect). ' +
      'Returns channel IDs, participant names, and whether it is a Connect DM. ' +
      'Use sinceIso to find conversations with activity since a specific time (e.g., today). ' +
      'Use this to find the right channel ID before calling slack_read_dm.',
    inputSchema: listDmsInputSchema,
    execute: input => _executeListDms(client, input, userCache),
  });
}

export function slackReadDmTool(client: webApi.WebClient, userCache?: UserCache) {
  return tool({
    description:
      'Read recent messages from a specific DM conversation. ' +
      'Get the channel ID from slack_list_dms or slack_search_messages. ' +
      'Use for "show me my recent DMs with person Y", "what did Z say to me yesterday?", etc.',
    inputSchema: readDmInputSchema,
    execute: input => _executeReadDm(client, input, userCache),
  });
}
