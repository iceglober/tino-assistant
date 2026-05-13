import { describe, it, expect } from 'vitest';
import { _executeListUsers } from '../../src/tools/slack/users.js';
import type { UserCache } from '../../src/slack/userCache.js';

// ---------------------------------------------------------------------------
// Mock UserCache factory
// ---------------------------------------------------------------------------

function makeUserCache(users: Array<{ id: string; name: string; isBot?: boolean; isExternal?: boolean }>): UserCache {
  const map = new Map(users.map(u => [u.id, {
    id: u.id,
    name: u.name,
    isBot: u.isBot ?? false,
    isExternal: u.isExternal ?? false,
    teamId: 'T001',
  }]));

  return {
    get: (userId: string) => map.get(userId),
    resolve: async (userId: string) => map.get(userId) ?? { id: userId, name: userId, isBot: false, isExternal: true, teamId: '' },
    getAll: () => [...map.values()],
    size: () => map.size,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_executeListUsers', () => {
  const sampleUsers = [
    { id: 'U001', name: 'Alice Smith' },
    { id: 'U002', name: 'Bob Jones' },
    { id: 'U003', name: 'Charlie Brown', isBot: true },
    { id: 'U004', name: 'alice.external', isExternal: true },
  ];

  // 1. No query — returns all users up to limit
  it('returns all users when no query provided', () => {
    const cache = makeUserCache(sampleUsers);
    const result = _executeListUsers(cache, { limit: 20 });

    expect(result.count).toBe(4);
    expect(result.users).toHaveLength(4);
  });

  // 2. Query filters by name substring (case-insensitive)
  it('filters users by case-insensitive name substring', () => {
    const cache = makeUserCache(sampleUsers);
    const result = _executeListUsers(cache, { query: 'alice', limit: 20 });

    expect(result.count).toBe(2);
    expect(result.users.map(u => u.id)).toEqual(expect.arrayContaining(['U001', 'U004']));
  });

  // 3. Query with no matches returns empty
  it('returns empty when query matches no users', () => {
    const cache = makeUserCache(sampleUsers);
    const result = _executeListUsers(cache, { query: 'zzznomatch', limit: 20 });

    expect(result.count).toBe(0);
    expect(result.users).toHaveLength(0);
  });

  // 4. Limit is respected
  it('respects the limit parameter', () => {
    const cache = makeUserCache(sampleUsers);
    const result = _executeListUsers(cache, { limit: 2 });

    expect(result.count).toBe(2);
    expect(result.users).toHaveLength(2);
  });

  // 5. isBot and isExternal flags are returned
  it('returns isBot and isExternal flags correctly', () => {
    const cache = makeUserCache(sampleUsers);
    const result = _executeListUsers(cache, { query: 'charlie', limit: 20 });

    expect(result.count).toBe(1);
    expect(result.users[0]).toMatchObject({ id: 'U003', name: 'Charlie Brown', isBot: true, isExternal: false });
  });

  // 6. Empty cache returns empty result
  it('returns empty result for empty cache', () => {
    const cache = makeUserCache([]);
    const result = _executeListUsers(cache, { limit: 20 });

    expect(result.count).toBe(0);
    expect(result.users).toHaveLength(0);
  });
});
