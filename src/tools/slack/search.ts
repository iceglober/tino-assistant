import { tool } from 'ai';
import { z } from 'zod';
import { webApi } from '@slack/bolt';

const inputSchema = z.object({
  query: z.string().min(1).describe(
    'Slack search query — same syntax as the Slack search bar. ' +
    'Examples: "from:@alice deployment", "in:#engineering auth bug", "has:link after:2026-05-01"'
  ),
  count: z.number().int().min(1).max(20).default(10).describe('Number of results (1–20, default 10)'),
});

type SearchInput = z.infer<typeof inputSchema>;

interface SlackSearchResult {
  messages: Array<{
    channel: { id: string; name: string };
    ts: string;
    text: string;
    user: string;
    permalink: string;
  }>;
  total: number;
}

type SearchResult = SlackSearchResult | { error: string; message: string };

export async function _executeSlackSearch(
  client: webApi.WebClient,
  input: SearchInput,
): Promise<SearchResult> {
  try {
    const res = await client.search.messages({
      query: input.query,
      count: input.count,
      sort: 'timestamp',
      sort_dir: 'desc',
    });

    const matches = res.messages?.matches ?? [];
    const messages = matches.map(m => ({
      channel: {
        id: m.channel?.id ?? '',
        name: m.channel?.name ?? '',
      },
      ts: m.ts ?? '',
      text: m.text ?? '',
      user: m.user ?? (m.username ?? ''),
      permalink: m.permalink ?? '',
    }));

    return {
      messages,
      total: res.messages?.total ?? 0,
    };
  } catch (err: unknown) {
    const e = err as { data?: { error?: string }; message?: string };
    const slackError = e.data?.error ?? e.message ?? 'unknown';
    if (slackError === 'not_authed' || slackError === 'invalid_auth' || slackError === 'token_revoked') {
      return { error: 'auth_error', message: `Slack auth failed: ${slackError}. Check SLACK_USER_TOKEN.` };
    }
    if (slackError === 'missing_scope') {
      return { error: 'missing_scope', message: 'SLACK_USER_TOKEN is missing the search:read scope.' };
    }
    return { error: 'slack_error', message: `Slack API error: ${slackError}` };
  }
}

export function slackSearchMessagesTool(client: webApi.WebClient) {
  return tool({
    description:
      'Search Slack messages across all channels the owner is a member of. ' +
      'Uses the same search syntax as the Slack search bar. ' +
      'Returns message text, channel, timestamp, user, and permalink. ' +
      'Use for "what did the team discuss about X?", "find messages from @alice about Y", etc.',
    inputSchema,
    execute: input => _executeSlackSearch(client, input),
  });
}
