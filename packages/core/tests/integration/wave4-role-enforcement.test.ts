import type { Auth } from "better-auth";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { IdentityStore, UserStore } from "../../src/identity/store.js";
import type { TinoUser } from "../../src/identity/types.js";
import { type AuthVariables, buildAuthMiddleware } from "../../src/server/middleware/auth.js";
import { requireAdmin } from "../../src/server/middleware/require-admin.js";
import { createAuditRoutes } from "../../src/server/routes/audit.js";
import { createCapabilityRoutes } from "../../src/server/routes/capabilities.js";

function noopLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function stubAuth(session: unknown): Auth {
  return { api: { getSession: async () => session } } as any as Auth;
}

function makeIdentities(map: Record<string, string>): IdentityStore {
  return {
    resolve: vi.fn(async (_p: string, externalId: string) => map[externalId] ?? null),
    link: vi.fn(),
    listForUser: vi.fn().mockResolvedValue([]),
  };
}

function makeMutableUsers(initial: TinoUser[]): UserStore {
  const byId = new Map(initial.map((u) => [u.id, { ...u }]));
  return {
    get: vi.fn(async (id: string) => {
      const u = byId.get(id);
      return u ? { ...u } : null;
    }),
    getByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (u: TinoUser) => { byId.set(u.id, u); return u; }),
    list: vi.fn(async () => [...byId.values()]),
    update: vi.fn(async (id: string, patch: Partial<TinoUser>) => {
      const existing = byId.get(id)!;
      const updated = { ...existing, ...patch };
      byId.set(id, updated);
      return updated;
    }),
  };
}

function makeAuditLogger() {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    lastEntryAt: vi.fn().mockResolvedValue(undefined),
  };
}

function buildFullApp(opts: { users: UserStore; identities: IdentityStore; auth: Auth }) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const logger = noopLogger();

  app.use("*", buildAuthMiddleware({
    auth: opts.auth,
    logger,
    identities: opts.identities,
    users: opts.users,
  }));

  app.route("/api/capabilities", createCapabilityRoutes({ config: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]), getTyped: vi.fn() } as any, logger }));
  app.route("/api/audit", createAuditRoutes({ auditLogger: makeAuditLogger(), logger }));
  app.get("/api/me/activity", (c) => c.json({ entries: [] }));

  return app;
}

describe("wave 4 — role enforcement integration", () => {
  it("member is rejected from admin routes", async () => {
    const users = makeMutableUsers([
      { id: "tino-uuid-member", email: "member@acme.io", name: "M", role: "member", status: "active", slackUserId: null, createdAt: 1, updatedAt: 1 },
    ]);
    const identities = makeIdentities({ "member@acme.io": "tino-uuid-member" });
    const auth = stubAuth({ user: { id: "ba-id", email: "member@acme.io", name: "M" } });
    const app = buildFullApp({ users, identities, auth });

    const capRes = await app.request("/api/capabilities");
    expect(capRes.status).toBe(403);

    const auditRes = await app.request("/api/audit");
    expect(auditRes.status).toBe(200);

    const activityRes = await app.request("/api/me/activity");
    expect(activityRes.status).toBe(200);
  });

  it("admin can access admin routes", async () => {
    const users = makeMutableUsers([
      { id: "tino-uuid-admin", email: "admin@acme.io", name: "A", role: "admin", status: "active", slackUserId: null, createdAt: 1, updatedAt: 1 },
    ]);
    const identities = makeIdentities({ "admin@acme.io": "tino-uuid-admin" });
    const auth = stubAuth({ user: { id: "ba-id", email: "admin@acme.io", name: "A" } });
    const app = buildFullApp({ users, identities, auth });

    const capRes = await app.request("/api/capabilities");
    expect(capRes.status).toBe(200);

    const auditRes = await app.request("/api/audit");
    expect(auditRes.status).toBe(200);
  });

  it("demoted admin cannot hit admin routes on next request", async () => {
    const users = makeMutableUsers([
      { id: "tino-uuid-admin", email: "admin@acme.io", name: "A", role: "admin", status: "active", slackUserId: null, createdAt: 1, updatedAt: 1 },
    ]);
    const identities = makeIdentities({ "admin@acme.io": "tino-uuid-admin" });
    const auth = stubAuth({ user: { id: "ba-id", email: "admin@acme.io", name: "A" } });
    const app = buildFullApp({ users, identities, auth });

    const before = await app.request("/api/capabilities");
    expect(before.status).toBe(200);

    await users.update("tino-uuid-admin", { role: "member" });

    const after = await app.request("/api/capabilities");
    expect(after.status).toBe(403);

    const auditStillOk = await app.request("/api/audit");
    expect(auditStillOk.status).toBe(200);
  });
});
