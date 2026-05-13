import { webApi } from '@slack/bolt';
import type { AppLogger } from './app.js';

export interface SlackUser {
  id: string;
  name: string;        // best display name: display_name > real_name > name > id
  isBot: boolean;
  isExternal: boolean;  // Slack Connect users
  teamId: string;
}

export interface UserCache {
  get(userId: string): SlackUser | undefined;
  resolve(userId: string): Promise<SlackUser>;  // cache hit or API fallback
  getAll(): SlackUser[];
  size(): number;
}

/**
 * Load the workspace user directory and return a cache.
 *
 * Uses users.list to bulk-load all users (paginated). This is called once
 * at startup. Individual user lookups (for external/Connect users not in
 * the workspace directory) fall back to users.info.
 *
 * Name resolution priority:
 * 1. profile.display_name (what the user chose to show)
 * 2. profile.real_name (full name)
 * 3. name (username/handle)
 * 4. id (fallback)
 */
export async function createUserCache(
  client: webApi.WebClient,
  logger: AppLogger,
): Promise<UserCache> {
  const cache = new Map<string, SlackUser>();

  // Bulk load via users.list (paginated)
  let cursor: string | undefined;
  let totalLoaded = 0;
  do {
    const res = await client.users.list({ limit: 200, cursor });
    const members = res.members ?? [];
    for (const m of members) {
      const id = (m as { id?: string }).id ?? '';
      if (!id) continue;
      const profile = (m as { profile?: { display_name?: string; real_name?: string } }).profile;
      cache.set(id, {
        id,
        name: profile?.display_name || profile?.real_name || (m as { name?: string }).name || id,
        isBot: (m as { is_bot?: boolean }).is_bot === true,
        isExternal: (m as { is_stranger?: boolean }).is_stranger === true ||
                    (m as { is_ultra_restricted?: boolean }).is_ultra_restricted === true,
        teamId: (m as { team_id?: string }).team_id ?? '',
      });
    }
    totalLoaded += members.length;
    cursor = (res.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;
  } while (cursor);

  logger.info({ userCount: totalLoaded }, 'slack user cache loaded');

  return {
    get(userId: string) {
      return cache.get(userId);
    },

    async resolve(userId: string): Promise<SlackUser> {
      const cached = cache.get(userId);
      if (cached) return cached;

      // Fallback for external/Connect users not in the workspace directory
      try {
        const res = await client.users.info({ user: userId });
        const profile = (res.user as { profile?: { display_name?: string; real_name?: string } } | undefined)?.profile;
        const user: SlackUser = {
          id: userId,
          name: profile?.display_name || profile?.real_name || userId,
          isBot: (res.user as { is_bot?: boolean } | undefined)?.is_bot === true,
          isExternal: true, // if not in workspace directory, it's external
          teamId: (res.user as { team_id?: string } | undefined)?.team_id ?? '',
        };
        cache.set(userId, user);
        return user;
      } catch {
        const fallback: SlackUser = { id: userId, name: userId, isBot: false, isExternal: true, teamId: '' };
        cache.set(userId, fallback);
        return fallback;
      }
    },

    getAll() {
      return [...cache.values()];
    },

    size() {
      return cache.size;
    },
  };
}
