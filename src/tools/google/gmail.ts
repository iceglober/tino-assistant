import { tool } from 'ai';
import { z } from 'zod';
import { google, type gmail_v1 } from 'googleapis';

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Gmail search query — same syntax as the Gmail search bar (e.g., "from:mom subject:trip", "after:2026/05/01 is:unread")',
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe('Maximum number of messages to return (1–20, default 10)'),
});

type GmailInput = z.infer<typeof inputSchema>;

interface GmailMessageMeta {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  internalDate: string; // epoch ms as string — that's what Gmail returns
}

type GmailResult =
  | { messages: GmailMessageMeta[]; count: number }
  | { error: string; message: string };

/**
 * Core gmail search logic, exported for unit testing.
 *
 * Flow:
 * 1. gmail.users.messages.list({ q: query, maxResults }) → returns message IDs
 * 2. For each ID, gmail.users.messages.get({ id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] })
 * 3. Extract subject, from, snippet, internalDate from each message
 * 4. Return the array
 *
 * The fan-out in step 2 is sequential (not batched) — fine for n≤20.
 * format: 'metadata' guarantees no body text is returned.
 */
export async function _executeGmailSearch(
  gmailClient: gmail_v1.Gmail,
  input: GmailInput,
): Promise<GmailResult> {
  const { query, maxResults } = input;

  try {
    // 1. List message IDs
    const listRes = await gmailClient.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messageIds = (listRes.data.messages ?? [])
      .map(m => m.id)
      .filter(Boolean) as string[];

    if (messageIds.length === 0) {
      return { messages: [], count: 0 };
    }

    // 2. Fetch metadata for each message
    const messages: GmailMessageMeta[] = [];
    for (const id of messageIds) {
      const msgRes = await gmailClient.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      const headers = msgRes.data.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      messages.push({
        id,
        threadId: msgRes.data.threadId ?? '',
        subject: getHeader('Subject'),
        from: getHeader('From'),
        snippet: msgRes.data.snippet ?? '',
        internalDate: msgRes.data.internalDate ?? '',
      });
    }

    return { messages, count: messages.length };
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 401 || e.code === 403) {
      return {
        error: 'auth_error',
        message: `Gmail auth failed (${e.code}): ${e.message ?? 'check refresh token and scopes'}`,
      };
    }
    return {
      error: 'google_error',
      message: `Gmail API error: ${e.message ?? 'unknown'}`,
    };
  }
}

export function gmailSearchTool(auth: OAuth2Client) {
  const gmailClient = google.gmail({ version: 'v1', auth });
  return tool({
    description:
      'Search Gmail messages. Returns metadata only (subject, from, snippet, date) — no message bodies. ' +
      'Use Gmail search syntax: "from:person subject:topic", "after:2026/05/01 is:unread", etc.',
    inputSchema,
    execute: input => _executeGmailSearch(gmailClient, input),
  });
}
