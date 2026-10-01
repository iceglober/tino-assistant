/**
 * In-memory implementations of the org-bound ports, for tests of code that sits
 * above the stores (resolver, assistant). The Postgres stores themselves are
 * covered against PGlite in persistence/stores.test.ts.
 */
import { type Identity, IdentityLinkConflictError, type TinoUser } from "@tino/core/domain/types";
import type { ConversationLog, IdentityStore, LoggedMessage, UserStore } from "@tino/core/ports/outbound";

export function memoryUsers(): UserStore {
  const byId = new Map<string, TinoUser>();
  return {
    async create(u) {
      byId.set(u.id, { ...u, email: u.email.toLowerCase() });
      return byId.get(u.id) as TinoUser;
    },
    get: async (id) => byId.get(id) ?? null,
    getByEmail: async (email) => [...byId.values()].find((u) => u.email === email.toLowerCase()) ?? null,
    list: async () => [...byId.values()],
    async update(id, patch) {
      const cur = byId.get(id);
      if (!cur) throw new Error(`tino_user not found: ${id}`);
      const next = { ...cur, ...patch, updatedAt: Date.now() } as TinoUser;
      byId.set(id, next);
      return next;
    },
  };
}

export function memoryIdentities(): IdentityStore {
  const rows = new Map<string, Identity>();
  return {
    resolve: async (provider, externalId) => rows.get(`${provider}|${externalId}`)?.tinoUserId ?? null,
    async link(identity) {
      const key = `${identity.provider}|${identity.externalId}`;
      if (rows.has(key)) throw new IdentityLinkConflictError(identity.provider, identity.externalId);
      rows.set(key, identity);
    },
    listForUser: async (id) => [...rows.values()].filter((r) => r.tinoUserId === id),
  };
}

export function memoryConversations(keepPerThread = 200): ConversationLog {
  let rows: LoggedMessage[] = [];
  return {
    async append(messages) {
      rows.push(...messages);
      for (const key of new Set(messages.map((m) => m.threadKey))) {
        const thread = rows.filter((m) => m.threadKey === key);
        const drop = new Set(thread.slice(0, Math.max(0, thread.length - keepPerThread)));
        rows = rows.filter((m) => !drop.has(m));
      }
    },
    recentInThread: async (key, limit) => rows.filter((m) => m.threadKey === key).slice(-limit),
    recentAskedBy: async (userId, limit) => rows.filter((m) => m.askedBy === userId).slice(-limit),
    async clearThread(key) {
      rows = rows.filter((m) => m.threadKey !== key);
    },
  };
}
