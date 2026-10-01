/**
 * Answers the two Slack questions that decide who reads a reply:
 *   - does this channel include anyone from outside the company?
 *   - which channels is this person in?
 *
 * "Outside the company" means: a Slack Connect channel, or any member who is a
 * guest, belongs to another team, or can't be found in our user directory.
 * Every lookup failure answers in the cautious direction.
 *
 * Results are cached briefly (2 min) — a person who just joined a channel may
 * wait that long before a DM can recall that channel's threads.
 */
import type { ChannelDirectory, Logger } from "../../../ports/outbound.js";

/** The slice of Slack's Web API this needs — small enough to fake in tests. */
export interface SlackDirectoryClient {
  auth: { test(): Promise<{ team_id?: string }> };
  conversations: {
    info(args: { channel: string }): Promise<{ channel?: SlackChannel }>;
    members(args: { channel: string; limit: number; cursor?: string }): Promise<{
      members?: string[];
      response_metadata?: { next_cursor?: string };
    }>;
  };
  users: {
    list(args: { limit: number; cursor?: string }): Promise<{
      members?: SlackUser[];
      response_metadata?: { next_cursor?: string };
    }>;
    conversations(args: {
      user: string;
      types: string;
      exclude_archived: boolean;
      limit: number;
      cursor?: string;
    }): Promise<{ channels?: Array<{ id?: string }>; response_metadata?: { next_cursor?: string } }>;
  };
}

interface SlackChannel {
  is_im?: boolean;
  is_ext_shared?: boolean;
  is_pending_ext_shared?: boolean;
}

interface SlackUser {
  id?: string;
  team_id?: string;
  deleted?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_stranger?: boolean;
}

const CACHE_MS = 2 * 60_000;
const CHANNEL_TYPES = ["public_channel", "private_channel", "mpim"];

const isMissingScope = (err: unknown): boolean =>
  (err as { data?: { error?: string } }).data?.error === "missing_scope" ||
  /missing_scope/.test((err as Error).message ?? "");
const DIRECTORY_CACHE_MS = 10 * 60_000;
/** Beyond this many members we stop paging and assume outsiders may be present. */
const MAX_MEMBERS_CHECKED = 20_000;

function cached<T>(ttlMs: number) {
  const store = new Map<string, { at: number; value: T }>();
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await load();
    store.set(key, { at: Date.now(), value });
    return value;
  };
}

export function createSlackChannelDirectory(client: SlackDirectoryClient, logger: Logger): ChannelDirectory {
  const channelCache = cached<{ includesOutsiders: boolean }>(CACHE_MS);
  const userChannelsCache = cached<ReadonlySet<string>>(CACHE_MS);
  let insiders: { at: number; homeTeamId: string; ids: Set<string> } | null = null;
  /** Channel types the bot turned out not to have the scope to list — not asked for again. */
  const typesWithoutScope = new Set<string>();

  async function listChannels(slackUserId: string, types: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    if (types.length === 0) return ids;
    let cursor: string | undefined;
    do {
      const page = await client.users.conversations({
        user: slackUserId,
        types: types.join(","),
        exclude_archived: true,
        limit: 1000,
        cursor,
      });
      for (const c of page.channels ?? []) if (c.id) ids.add(c.id);
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return ids;
  }

  /** Everyone who is a full member of our own workspace. */
  async function loadInsiders(): Promise<Set<string>> {
    if (insiders && Date.now() - insiders.at < DIRECTORY_CACHE_MS) return insiders.ids;
    const homeTeamId = (await client.auth.test()).team_id ?? "";
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.users.list({ limit: 200, cursor });
      for (const u of page.members ?? []) {
        const isGuest = u.is_restricted || u.is_ultra_restricted || u.is_stranger;
        const otherTeam = !!homeTeamId && !!u.team_id && u.team_id !== homeTeamId;
        if (u.id && !u.deleted && !isGuest && !otherTeam) ids.add(u.id);
      }
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    insiders = { at: Date.now(), homeTeamId, ids };
    return ids;
  }

  async function channelMembers(channelId: string): Promise<string[] | null> {
    const all: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.conversations.members({ channel: channelId, limit: 1000, cursor });
      all.push(...(page.members ?? []));
      if (all.length > MAX_MEMBERS_CHECKED) return null;
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return all;
  }

  return {
    async describeChannel(channelId) {
      try {
        return await channelCache(channelId, async () => {
          const channel = (await client.conversations.info({ channel: channelId })).channel;
          if (!channel) return { includesOutsiders: true };
          if (channel.is_ext_shared || channel.is_pending_ext_shared) return { includesOutsiders: true };
          const [members, ours] = await Promise.all([channelMembers(channelId), loadInsiders()]);
          if (!members) return { includesOutsiders: true };
          return { includesOutsiders: members.some((id) => !ours.has(id)) };
        });
      } catch (err) {
        logger.warn({ channelId, err: (err as Error).message }, "slack channel lookup failed");
        return null;
      }
    },

    channelsOfSlackUser(slackUserId) {
      return userChannelsCache(slackUserId, async () => {
        const allowed = CHANNEL_TYPES.filter((t) => !typesWithoutScope.has(t));
        try {
          return await listChannels(slackUserId, allowed);
        } catch (err) {
          if (!isMissingScope(err)) throw err;
        }
        // The bot lacks a scope for one of the types: ask one type at a time and
        // keep what it can see. A type it can't read just contributes nothing.
        const ids = new Set<string>();
        for (const type of allowed) {
          try {
            for (const id of await listChannels(slackUserId, [type])) ids.add(id);
          } catch (err) {
            if (!isMissingScope(err)) throw err;
            typesWithoutScope.add(type);
            const needed = (err as { data?: { needed?: string } }).data?.needed;
            logger.warn(
              { type, needed },
              "slack bot can't list this channel type for a person — add the scope to recall it",
            );
          }
        }
        return ids;
      });
    },
  };
}
