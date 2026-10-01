/**
 * The Gmail side of "don't learn from": what a person can pick (their labels
 * and filters), and which messages an exclusion matches (for cleaning up what
 * was learned before it existed). Uses the person's own read-only grant.
 */
import { google } from "googleapis";
import {
  describeGmailFilter,
  type GmailExclusion,
  type GmailFilterCriteria,
  searchForGmailFilter,
} from "../../../../domain/dont-learn-from.js";
import type { UserCapabilityStore } from "../../../../ports/outbound.js";
import { readUserCredentials } from "../../tools/credentials.js";

export type GmailClient = ReturnType<typeof google.gmail>;

export async function gmailClientFor(userId: string, caps: UserCapabilityStore): Promise<GmailClient | null> {
  const creds = (await readUserCredentials(userId, "gmail", caps))?.credentials;
  if (!creds?.clientId || !creds?.clientSecret || !creds?.refreshToken) return null;
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return google.gmail({ version: "v1", auth });
}

export interface GmailExclusionOptions {
  labels: Array<{ id: string; name: string }>;
  filters: Array<{ id: string; description: string; query: string; labelIds: string[] }>;
}

/** The person's own labels and filters, for the picker. */
export async function gmailExclusionOptions(gmail: GmailClient): Promise<GmailExclusionOptions> {
  const [labels, filters] = await Promise.all([
    gmail.users.labels.list({ userId: "me" }),
    gmail.users.settings.filters.list({ userId: "me" }),
  ]);
  return {
    labels: (labels.data.labels ?? [])
      .filter((l) => l.type === "user" && l.id && l.name)
      .map((l) => ({ id: l.id as string, name: l.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    filters: (filters.data.filter ?? []).flatMap((f) => {
      const criteria = (f.criteria ?? {}) as GmailFilterCriteria;
      const query = searchForGmailFilter(criteria);
      return f.id && query
        ? [{ id: f.id, description: describeGmailFilter(criteria), query, labelIds: f.action?.addLabelIds ?? [] }]
        : [];
    }),
  };
}

/** Ids of messages since `afterSec` that an exclusion matches (capped). */
export async function messagesMatching(
  gmail: GmailClient,
  exclusion: GmailExclusion,
  afterSec: number,
  maxMessages = 5000,
): Promise<{ ids: string[]; apiCalls: number }> {
  const ids: string[] = [];
  let apiCalls = 0;
  let pageToken: string | undefined;
  do {
    apiCalls++;
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 500,
      pageToken,
      includeSpamTrash: true,
      ...(exclusion.kind === "gmailLabel"
        ? { labelIds: [exclusion.labelId], q: `after:${afterSec}` }
        : { q: `(${exclusion.query}) after:${afterSec}` }),
    });
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < maxMessages);
  return { ids, apiCalls };
}
