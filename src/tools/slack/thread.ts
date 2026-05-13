import { tool } from 'ai';
import { z } from 'zod';
import { webApi } from '@slack/bolt';
import type { UserCache } from '../../slack/userCache.js';

const inputSchema = z.object({
  channel: z.string().min(1).describe('Channel ID (e.g., "C01ABC123" — get this from slack_search_messages results)'),
  threadTs: z.string().min(1).describe('Thread timestamp (the ts of the parent message — get this from slack_search_messages results)'),
  limit: z.number().int().min(1).max(100).default(20).describe('Max replies to return (1–100, default 20)'),
});

type ThreadInput = z.infer<typeof inputSchema>;

interface ThreadMessage {
  user: string;
  userName: string;
  text: string;
  ts: string;
}

type ThreadResult =
  | { messages: ThreadMessage[]; count: number; hasMore: boolean }
  | { error: string; message: string };

export async function _executeSlackReadThread(
  client: webApi.WebClient,
  input: ThreadInput,
  userCache?: UserCache,
): Promise<ThreadResult> {
  try {
    const res = await client.conversations.replies({
      channel: input.channel,
      ts: input.threadTs,
      limit: input.limit,
      inclusive: true, // include the parent message
    });

    const messages = await Promise.all((res.messages ?? []).map(async m => {
      const userId = m.user ?? '';
      let userName = userId;
      if (userCache && userId) {
        userName = (await userCache.resolve(userId)).name;
      }
      return {
        user: userId,
        userName,
        text: m.text ?? '',
        ts: m.ts ?? '',
      };
    }));

    return {
      messages,
      count: messages.length,
      hasMore: res.has_more ?? false,
    };
  } catch (err: unknown) {
    const e = err as { data?: { error?: string }; message?: string };
    const slackError = e.data?.error ?? e.message ?? 'unknown';
    if (slackError === 'not_authed' || slackError === 'invalid_auth' || slackError === 'token_revoked') {
      return { error: 'auth_error', message: `Slack auth failed: ${slackError}. Check SLACK_USER_TOKEN.` };
    }
    if (slackError === 'channel_not_found') {
      return { error: 'channel_not_found', message: `Channel ${input.channel} not found or you're not a member.` };
    }
    if (slackError === 'thread_not_found') {
      return { error: 'thread_not_found', message: 'Thread not found at the given timestamp.' };
    }
    if (slackError === 'missing_scope') {
      return { error: 'missing_scope', message: 'SLACK_USER_TOKEN is missing channels:history or groups:history scope.' };
    }
    return { error: 'slack_error', message: `Slack API error: ${slackError}` };
  }
}

export function slackReadThreadTool(client: webApi.WebClient, userCache: UserCache) {
  return tool({
    description:
      'Read a Slack thread (all replies to a message). ' +
      'Requires the channel ID and the parent message timestamp (both available from slack_search_messages results). ' +
      'Use for "catch me up on this thread", "what was the conclusion of the discussion about X?", etc.',
    inputSchema,
    execute: input => _executeSlackReadThread(client, input, userCache),
  });
}
