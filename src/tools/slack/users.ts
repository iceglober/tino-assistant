import { tool } from 'ai';
import { z } from 'zod';
import type { UserCache } from '../../slack/userCache.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const listUsersInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Filter users by name (case-insensitive substring match). Omit to list all.'),
  limit: z.number().int().min(1).max(50).default(20),
});

type ListUsersInput = z.infer<typeof listUsersInputSchema>;

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export function _executeListUsers(
  cache: UserCache,
  input: ListUsersInput,
): { users: Array<{ id: string; name: string; isBot: boolean; isExternal: boolean }>; count: number } {
  const all = cache.getAll();
  const query = input.query?.toLowerCase();

  const filtered = query
    ? all.filter(u => u.name.toLowerCase().includes(query))
    : all;

  const limited = filtered.slice(0, input.limit);

  return {
    users: limited.map(u => ({
      id: u.id,
      name: u.name,
      isBot: u.isBot,
      isExternal: u.isExternal,
    })),
    count: limited.length,
  };
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export function slackListUsersTool(userCache: UserCache) {
  return tool({
    description:
      'Look up Slack users by name from the cached workspace directory. ' +
      'Use this to resolve "who is [person]?" or to find a user ID before calling other tools. ' +
      'Returns id, name, isBot, and isExternal for each match.',
    inputSchema: listUsersInputSchema,
    execute: async (input: ListUsersInput) => _executeListUsers(userCache, input),
  });
}
