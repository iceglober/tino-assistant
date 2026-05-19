import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { IdentityStore, UserStore } from "../../src/identity/store.js";
import type { TinoUser } from "../../src/identity/types.js";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createOrgConfigRoutes } from "../../src/server/routes/org-config.js";
import { makeConfigStore, noopLogger } from "./_helpers.js";

const adminUser: AuthVariables["user"] = {
  id: "tino-uuid-admin",
  email: "admin@acme.io",
  name: "Admin",
  role: "admin",
  status: "active",
  slackUserId: "U_ADMIN",
};

const memberUser: AuthVariables["user"] = {
  id: "tino-uuid-member",
  email: "member@acme.io",
  name: "Member",
  role: "member",
  status: "active",
  slackUserId: "U_MEMBER",
};

function makeUsers(initial: TinoUser[] = []): UserStore {
  const byId = new Map(initial.map((u) => [u.id, u]));
  const byEmail = new Map(initial.map((u) => [u.email.toLowerCase(), u]));
  return {
    get: vi.fn(async (id: string) => byId.get(id) ?? null),
    getByEmail: vi.fn(async (email: string) => byEmail.get(email.toLowerCase()) ?? null),
    create: vi.fn(async (u: TinoUser) => {
      byId.set(u.id, u);
      byEmail.set(u.email.toLowerCase(), u);
      return u;
    }),
    list: vi.fn(async () => [...byId.values()]),
    update: vi.fn(async (id: string, patch: Partial<TinoUser>) => {
      const existing = byId.get(id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, ...patch, updatedAt: Date.now() };
      byId.set(id, updated);
      return updated;
    }),
  };
}

function makeIdentities(): IdentityStore {
  return {
    resolve: vi.fn().mockResolvedValue(null),
    link: vi.fn(),
    listForUser: vi.fn().mockResolvedValue([]),
  };
}

function buildApp(currentUser: AuthVariables["user"], opts?: { config?: ReturnType<typeof makeConfigStore> }) {
  const config = opts?.config ?? makeConfigStore();
  const users = makeUsers();
  const identities = makeIdentities();
  const auditLogger = { log: vi.fn().mockResolvedValue(undefined), query: vi.fn(), count: vi.fn(), lastEntryAt: vi.fn() };

  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", currentUser);
    await next();
  });
  app.route(
    "/api/org",
    createOrgConfigRoutes({ config, users, identities, logger: noopLogger(), auditLogger }),
  );

  return { app, config, users, identities, auditLogger };
}

describe("org-config routes", () => {
  it("GET /api/org/access-control returns the current config", async () => {
    const config = makeConfigStore({
      "org.accessControl.mode": "org-domain",
      "org.accessControl.orgDomain": "acme.io",
    });
    const { app } = buildApp(adminUser, { config });

    const res = await app.request("/api/org/access-control");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; orgDomain: string };
    expect(body.mode).toBe("org-domain");
    expect(body.orgDomain).toBe("acme.io");
  });

  it("GET /api/org/access-control defaults to allowlist when no config", async () => {
    const { app } = buildApp(adminUser);

    const res = await app.request("/api/org/access-control");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; orgDomain?: string };
    expect(body.mode).toBe("allowlist");
    expect(body.orgDomain).toBeUndefined();
  });

  it("PUT /api/org/access-control as admin updates mode", async () => {
    const { app, config } = buildApp(adminUser);

    const res = await app.request("/api/org/access-control", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "org-domain", orgDomain: "acme.io" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mode: string; orgDomain: string };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("org-domain");
    expect(config.set).toHaveBeenCalled();
  });

  it("PUT /api/org/access-control as member returns 403", async () => {
    const { app } = buildApp(memberUser);

    const res = await app.request("/api/org/access-control", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "allowlist" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("admin role required");
  });

  it("POST /api/org/users adds a user", async () => {
    const { app, users, identities } = buildApp(adminUser);

    const res = await app.request("/api/org/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newbie@acme.io", slackUserId: "U_NEWBIE" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; user: TinoUser };
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe("newbie@acme.io");
    expect(body.user.status).toBe("invited");
    expect(body.user.role).toBe("member");
    expect(users.create).toHaveBeenCalled();
    expect(identities.link).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "slack",
        externalId: "U_NEWBIE",
      }),
    );
  });

  it("PATCH /api/org/users/:id/status suspends a user", async () => {
    const existingUser: TinoUser = {
      id: "tino-uuid-target",
      email: "target@acme.io",
      role: "member",
      status: "active",
      slackUserId: "U_TARGET",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const users = makeUsers([existingUser]);
    const config = makeConfigStore();
    const identities = makeIdentities();
    const auditLogger = { log: vi.fn().mockResolvedValue(undefined), query: vi.fn(), count: vi.fn(), lastEntryAt: vi.fn() };

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", adminUser);
      await next();
    });
    app.route(
      "/api/org",
      createOrgConfigRoutes({ config, users, identities, logger: noopLogger(), auditLogger }),
    );

    const res = await app.request("/api/org/users/tino-uuid-target/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "suspended" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; user: TinoUser };
    expect(body.ok).toBe(true);
    expect(body.user.status).toBe("suspended");
    expect(users.update).toHaveBeenCalledWith("tino-uuid-target", { status: "suspended" });
  });

  it("PATCH /api/org/users/:id/status returns 404 for unknown user", async () => {
    const { app } = buildApp(adminUser);

    const res = await app.request("/api/org/users/nonexistent/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "suspended" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/org/users lists all users", async () => {
    const existingUsers: TinoUser[] = [
      { id: "u1", email: "a@acme.io", role: "admin", status: "active", slackUserId: null, createdAt: 1000, updatedAt: 1000 },
      { id: "u2", email: "b@acme.io", role: "member", status: "active", slackUserId: null, createdAt: 2000, updatedAt: 2000 },
    ];
    const users = makeUsers(existingUsers);
    const config = makeConfigStore();
    const identities = makeIdentities();
    const auditLogger = { log: vi.fn().mockResolvedValue(undefined), query: vi.fn(), count: vi.fn(), lastEntryAt: vi.fn() };

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", adminUser);
      await next();
    });
    app.route("/api/org", createOrgConfigRoutes({ config, users, identities, logger: noopLogger(), auditLogger }));

    const res = await app.request("/api/org/users");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: TinoUser[] };
    expect(body.users).toHaveLength(2);
  });

  it("PATCH /api/org/users/:id changes role and emits role_change audit", async () => {
    const existingUsers: TinoUser[] = [
      { id: "tino-uuid-admin", email: "admin@acme.io", role: "admin", status: "active", slackUserId: "U_ADMIN", createdAt: 1000, updatedAt: 1000 },
      { id: "tino-uuid-other-admin", email: "admin2@acme.io", role: "admin", status: "active", slackUserId: null, createdAt: 1000, updatedAt: 1000 },
      { id: "tino-uuid-target", email: "target@acme.io", role: "member", status: "active", slackUserId: null, createdAt: 1000, updatedAt: 1000 },
    ];
    const users = makeUsers(existingUsers);
    const config = makeConfigStore();
    const identities = makeIdentities();
    const auditLogger = { log: vi.fn().mockResolvedValue(undefined), query: vi.fn(), count: vi.fn(), lastEntryAt: vi.fn() };

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", adminUser);
      await next();
    });
    app.route("/api/org", createOrgConfigRoutes({ config, users, identities, logger: noopLogger(), auditLogger }));

    const res = await app.request("/api/org/users/tino-uuid-target", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; user: TinoUser };
    expect(body.ok).toBe(true);
    expect(body.user.role).toBe("admin");
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "role_change" }),
    );
  });

  it("admin cannot demote self", async () => {
    const existingUsers: TinoUser[] = [
      { id: "tino-uuid-admin", email: "admin@acme.io", role: "admin", status: "active", slackUserId: "U_ADMIN", createdAt: 1000, updatedAt: 1000 },
    ];
    const users = makeUsers(existingUsers);
    const config = makeConfigStore();
    const identities = makeIdentities();
    const auditLogger = { log: vi.fn().mockResolvedValue(undefined), query: vi.fn(), count: vi.fn(), lastEntryAt: vi.fn() };

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", adminUser);
      await next();
    });
    app.route("/api/org", createOrgConfigRoutes({ config, users, identities, logger: noopLogger(), auditLogger }));

    const res = await app.request("/api/org/users/tino-uuid-admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cannot change your own role/);
  });

  it("last-admin guard blocks demotion when only one non-suspended admin remains", async () => {
    const actorAdmin: AuthVariables["user"] = {
      id: "tino-uuid-actor",
      email: "actor@acme.io",
      name: "Actor",
      role: "admin",
      status: "active",
      slackUserId: null,
    };
    const existingUsers: TinoUser[] = [
      { id: "tino-uuid-actor", email: "actor@acme.io", role: "admin", status: "active", slackUserId: null, createdAt: 1000, updatedAt: 1000 },
      { id: "tino-uuid-target", email: "target@acme.io", role: "admin", status: "suspended", slackUserId: null, createdAt: 1000, updatedAt: 1000 },
    ];
    const users = makeUsers(existingUsers);
    const config = makeConfigStore();
    const identities = makeIdentities();
    const auditLogger = { log: vi.fn().mockResolvedValue(undefined), query: vi.fn(), count: vi.fn(), lastEntryAt: vi.fn() };

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", actorAdmin);
      await next();
    });
    app.route("/api/org", createOrgConfigRoutes({ config, users, identities, logger: noopLogger(), auditLogger }));

    const res = await app.request("/api/org/users/tino-uuid-target", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cannot demote the last admin/);
  });
});
