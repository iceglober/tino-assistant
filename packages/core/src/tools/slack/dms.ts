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

    // Collect all DM conversations (paginated)
    const allChannels: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const res = await client.conversations.list({
        types: 'im,mpim',
        limit: 200,
        exclude_archived: true,
        cursor,
      });
      const channels = (res.channels ?? []) as Array<Record<string, unknown>>;
      allChannels.push(...channels);
      cursor = (res.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;
    } while (cursor);

    for (const ch of allChannels) {
      const channelId = (ch.id as string) ?? '';
      if (!channelId) continue;

      // When sinceIso is provided, verify the conversation has REAL messages
      // from that time period — not just any activity signal. The `updated`
      // field on conversations.list is unreliable (includes reactions, typing
      // indicators, metadata changes). We call conversations.history with
      // `oldest` and check if any messages came back.
      if (sinceEpoch !== undefined) {
        try {
          const histRes = await client.conversations.history({
            channel: channelId,
            oldest: String(sinceEpoch),
            limit: 1,
          });
          const msgs = histRes.messages ?? [];
          if (msgs.length === 0) continue; // no real messages since sinceIso — skip
        } catch {
          continue; // can't read this conversation — skip
        }
      }

      const isGroup = (ch.is_mpim as boolean) === true;
      const isConnect =
        (ch.is_ext_shared as boolean) === true ||
        ((ch.connected_team_ids as string[] | undefined)?.length ?? 0) > 0;

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
        const userId = ch.user as string | undefined;
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

      // Stop once we have enough
      if (conversations.length >= input.limit) break;
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
