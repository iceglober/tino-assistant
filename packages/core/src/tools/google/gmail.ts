import { tool } from 'ai';
import { z } from 'zod';
import { google, type gmail_v1 } from 'googleapis';

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// ---------------------------------------------------------------------------
// gmail_get_message
// ---------------------------------------------------------------------------

const BODY_MAX_BYTES = 50 * 1024; // 50 KB — same cap as github_get_file

const getMessageInputSchema = z.object({
  messageId: z.string().min(1).describe('Gmail message ID (from gmail_search results)'),
});

type GetMessageInput = z.infer<typeof getMessageInputSchema>;

type GetMessageResult =
  | { id: string; threadId: string; subject: string; from: string; body: string; truncated: boolean }
  | { error: string; message: string };

/**
 * Walk a MIME payload tree looking for a part with the given mimeType.
 * Returns the first match, or null if not found.
 */
function findPart(
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): gmail_v1.Schema$MessagePart | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

/**
 * Decode a base64url-encoded string to UTF-8 text.
 * Gmail uses URL-safe base64 (- and _ instead of + and /).
 */
function decodeBase64Url(data: string): string {
  // Convert URL-safe base64 to standard base64
  const standard = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard, 'base64').toString('utf8');
}

/**
 * Strip HTML tags from a string. Basic — good enough for email body extraction.
 * Collapses whitespace runs to single spaces and trims.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Core gmail_get_message logic, exported for unit testing.
 *
 * Flow:
 * 1. gmail.users.messages.get({ id: messageId, format: 'full' })
 * 2. Walk payload.parts for mimeType === 'text/plain'; decode base64url body.data
 * 3. If no text/plain, look for text/html and strip tags
 * 4. Truncate body to 50 KB
 */
export async function _executeGmailGetMessage(
  gmailClient: gmail_v1.Gmail,
  input: GetMessageInput,
): Promise<GetMessageResult> {
  const { messageId } = input;

  try {
    const res = await gmailClient.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const data = res.data;
    const headers = data.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    // Extract body: prefer text/plain, fall back to text/html
    let rawBody = '';
    const plainPart = findPart(data.payload ?? undefined, 'text/plain');
    if (plainPart?.body?.data) {
      rawBody = decodeBase64Url(plainPart.body.data);
    } else {
      const htmlPart = findPart(data.payload ?? undefined, 'text/html');
      if (htmlPart?.body?.data) {
        rawBody = stripHtmlTags(decodeBase64Url(htmlPart.body.data));
      }
    }

    const truncated = rawBody.length > BODY_MAX_BYTES;
    const body = truncated ? rawBody.slice(0, BODY_MAX_BYTES) : rawBody;

    return {
      id: data.id ?? messageId,
      threadId: data.threadId ?? '',
      subject: getHeader('Subject'),
      from: getHeader('From'),
      body,
      truncated,
    };
  } catch (err: unknown) {
    const e = err as { code?: number; status?: number; message?: string };
    const code = e.code ?? e.status;
    if (code === 404) {
      return { error: 'not_found', message: `Message ${messageId} not found.` };
    }
    if (code === 401 || code === 403) {
      return {
        error: 'auth_error',
        message: `Gmail auth failed (${code}): ${e.message ?? 'check refresh token and scopes'}`,
      };
    }
    return {
      error: 'google_error',
      message: `Gmail API error: ${e.message ?? 'unknown'}`,
    };
  }
}

export function gmailGetMessageTool(auth: OAuth2Client) {
  const gmailClient = google.gmail({ version: 'v1', auth });
  return tool({
    description:
      'Read the full body of a specific Gmail message by its ID. ' +
      'Use gmail_search first to find message IDs, then call this to read the content. ' +
      'Returns plain text body (up to 50 KB). If the message has only HTML, tags are stripped.',
    inputSchema: getMessageInputSchema,
    execute: input => _executeGmailGetMessage(gmailClient, input),
  });
}

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
