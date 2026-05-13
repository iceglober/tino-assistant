import { tool } from 'ai';
import { z } from 'zod';
import { webApi } from '@slack/bolt';

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
// User name resolution (shared cache across both tools in a single call)
// ---------------------------------------------------------------------------

async function resolveUserName(
  client: webApi.WebClient,
  userId: string,
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(userId)) return cache.get(userId)!;
  try {
    const res = await client.users.info({ user: userId });
    const name =
      (res.user as { profile?: { display_name?: string; real_name?: string } } | undefined)
        ?.profile?.display_name ||
      (res.user as { profile?: { display_name?: string; real_name?: string } } | undefined)
        ?.profile?.real_name ||
      userId;
    cache.set(userId, name);
    return name;
  } catch {
    cache.set(userId, userId);
    return userId;
  }
}

// ---------------------------------------------------------------------------
// _executeListDms
// ---------------------------------------------------------------------------

export async function _executeListDms(
  client: webApi.WebClient,
  input: ListDmsInput,
): Promise<ListDmsResult> {
  try {
    const res = await client.conversations.list({
      types: 'im,mpim',
      limit: input.limit,
      exclude_archived: true,
    });

    const channels = res.channels ?? [];
    const userCache = new Map<string, string>();
    const conversations: DmConversation[] = [];

    for (const ch of channels) {
      const channelId = (ch as { id?: string }).id ?? '';
      const isGroup = (ch as { is_mpim?: boolean }).is_mpim === true;
      // Slack Connect DMs have is_ext_shared or connected_team_ids
      const isConnect =
        (ch as { is_ext_shared?: boolean }).is_ext_shared === true ||
        ((ch as { connected_team_ids?: string[] }).connected_team_ids?.length ?? 0) > 0;

      if (isGroup) {
        // Group DM: fetch members and resolve names
        let memberNames: string[] = [];
        try {
          const membersRes = await client.conversations.members({ channel: channelId });
          const memberIds = (membersRes.members ?? []) as string[];
          memberNames = await Promise.all(
            memberIds.map(uid => resolveUserName(client, uid, userCache)),
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
        // 1:1 DM: single user field
        const userId = (ch as { user?: string }).user;
        let userName: string | undefined;
        if (userId) {
          userName = await resolveUserName(client, userId, userCache);
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
): Promise<ReadDmResult> {
  try {
    const res = await client.conversations.history({
      channel: input.channel,
      limit: input.limit,
    });

    const userCache = new Map<string, string>();
    const rawMessages = res.messages ?? [];

    const messages: DmMessage[] = await Promise.all(
      rawMessages.map(async m => {
        const userId = (m as { user?: string }).user ?? '';
        const userName = userId ? await resolveUserName(client, userId, userCache) : '';
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

export function slackListDmsTool(client: webApi.WebClient) {
  return tool({
    description:
      'List your recent DM conversations (1:1 and group, including Slack Connect). ' +
      'Returns channel IDs, participant names, and whether it is a Connect DM. ' +
      'Use this to find the right channel ID before calling slack_read_dm.',
    inputSchema: listDmsInputSchema,
    execute: input => _executeListDms(client, input),
  });
}

export function slackReadDmTool(client: webApi.WebClient) {
  return tool({
    description:
      'Read recent messages from a specific DM conversation. ' +
      'Get the channel ID from slack_list_dms or slack_search_messages. ' +
      'Use for "show me my recent DMs with person Y", "what did Z say to me yesterday?", etc.',
    inputSchema: readDmInputSchema,
    execute: input => _executeReadDm(client, input),
  });
}
