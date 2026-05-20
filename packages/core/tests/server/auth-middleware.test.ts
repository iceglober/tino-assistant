import type { Auth } from "better-auth";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type AuthVariables, buildAuthMiddleware } from "../../src/server/middleware/auth.js";
import { requireAdmin } from "../../src/server/middleware/require-admin.js";
import type { IdentityStore } from "../../src/identity/store.js";
import type { UserStore } from "../../src/identity/store.js";
import type { TinoUser } from "../../src/identity/types.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AppLogger } from "../../src/slack/app.js";

function noopLogger(): AppLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function stubAuth(session: unknown): Auth {
  return {
    api: {
      getSession: async () => session,
    },
  } as any as Auth;
}

const adminUser: TinoUser = {
  id: "tino-uuid-admin",
  email: "admin@acme.io",
  name: "Admin",
  role: "admin",
  status: "active",
  slackUserId: "U_ADMIN",
  createdAt: 1000,
  updatedAt: 1000,
};

const memberUser: TinoUser = {
  id: "tino-uuid-member",
  email: "member@acme.io",
  name: "Member",
  role: "member",
  status: "active",
  slackUserId: "U_MEMBER",
  createdAt: 2000,
  updatedAt: 2000,
};

const suspendedUser: TinoUser = {
  ...memberUser,
  id: "tino-uuid-suspended",
  email: "suspended@acme.io",
  status: "suspended",
};

function makeIdentities(map: Record<string, string> = {}): IdentityStore {
  return {
    resolve: vi.fn(async (_provider: string, externalId: string) => map[externalId] ?? null),
    link: vi.fn(),
    listForUser: vi.fn().mockResolvedValue([]),
  };
}

function makeUsers(users: TinoUser[] = []): UserStore {
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    get: vi.fn(async (id: string) => byId.get(id) ?? null),
    getByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (u: TinoUser) => {
      byId.set(u.id, u);
      return u;
    }),
    list: vi.fn().mockResolvedValue([...byId.values()]),
    update: vi.fn(),
  };
}

function makeConfigStore(config: Record<string, string> = {}): ConfigStore {
  return {
    get: vi.fn(async (key: string) => config[key] ?? null),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getTyped: vi.fn(),
  } as unknown as ConfigStore;
}

function buildApp(
  auth: Auth | null,
  opts: {
    allowedDomain?: string;
    identities?: IdentityStore;
    users?: UserStore;
    configStore?: ConfigStore;
  } = {},
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(
    "*",
    buildAuthMiddleware({
      auth,
      allowedDomain: opts.allowedDomain,
      logger: noopLogger(),
      identities: opts.identities,
      users: opts.users,
      configStore: opts.configStore,
    }),
  );
  app.get("/api/config", (c) => c.json([{ key: "k", value: "v" }]));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/user-info", (c) => c.json(c.get("user")));
  app.get("/", (c) => c.html("<!DOCTYPE html><html></html>"));
  app.get("/assets/tino-logo.png", (c) => c.body(new Uint8Array([0x89, 0x50])));
  return app;
}

describe("auth middleware — 401 JSON for unauthenticated /api/* (gap #2)", () => {
  it("returns 401 JSON for /api/config when no session", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/api/config");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unauthorized");
    expect(body.message).toBe("sign in required");
  });

  it("passes /api/config through when session exists (no identity stores)", async () => {
    const app = buildApp(stubAuth({ user: { id: "u1", email: "a@example.com", name: "A" } }));
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
  });

  it("exempts /api/health from auth", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });

  it("exempts /assets/* from auth", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/assets/tino-logo.png");
    expect(res.status).toBe(200);
  });

  it("lets non-API requests fall through when no session", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("is a no-op when auth is null (local dev)", async () => {
    const app = buildApp(null);
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
  });

  it("returns 403 when session email is outside allowedDomain", async () => {
    const app = buildApp(stubAuth({ user: { id: "u1", email: "evil@other.com", name: "A" } }), {
      allowedDomain: "example.com",
    });
    const res = await app.request("/api/config");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("admits session whose email matches allowedDomain", async () => {
    const app = buildApp(stubAuth({ user: { id: "u1", email: "ok@example.com", name: "A" } }), {
      allowedDomain: "example.com",
    });
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
  });
});

describe("auth middleware — tino-UUID resolution (wave 3 a6)", () => {
  it("middleware resolves session to tinoUserId via identity resolver", async () => {
    const identities = makeIdentities({ "admin@acme.io": "tino-uuid-admin" });
    const users = makeUsers([adminUser]);
    const app = buildApp(stubAuth({ user: { id: "ba-id", email: "admin@acme.io", name: "Admin" } }), {
      identities,
      users,
    });

    const res = await app.request("/api/user-info");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthVariables["user"];
    expect(body.id).toBe("tino-uuid-admin");
    expect(body.role).toBe("admin");
    expect(body.status).toBe("active");
    expect(body.email).toBe("admin@acme.io");
  });

  it("suspended user returns 403", async () => {
    const identities = makeIdentities({ "suspended@acme.io": "tino-uuid-suspended" });
    const users = makeUsers([suspendedUser]);
    const app = buildApp(stubAuth({ user: { id: "ba-id", email: "suspended@acme.io", name: "S" } }), {
      identities,
      users,
    });

    const res = await app.request("/api/config");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("your access has been revoked");
  });

  it("unknown user with no org-domain returns 403", async () => {
    const identities = makeIdentities({});
    const users = makeUsers([]);
    const configStore = makeConfigStore({});
    const app = buildApp(stubAuth({ user: { id: "ba-id", email: "stranger@other.io", name: "X" } }), {
      identities,
      users,
      configStore,
    });

    const res = await app.request("/api/config");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("not provisioned");
  });

  it("unknown user in org-domain mode with matching email auto-provisions", async () => {
    const identities = makeIdentities({});
    const users = makeUsers([]);
    const configStore = makeConfigStore({
      "org.accessControl.mode": JSON.stringify("org-domain"),
      "org.accessControl.orgDomain": JSON.stringify("acme.io"),
    });
    const app = buildApp(stubAuth({ user: { id: "ba-id", email: "new@acme.io", name: "New" } }), {
      identities,
      users,
      configStore,
    });

    const res = await app.request("/api/user-info");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthVariables["user"];
    expect(body.email).toBe("new@acme.io");
    expect(body.role).toBe("admin");
    expect(body.status).toBe("active");
    expect(users.create).toHaveBeenCalled();
    expect(identities.link).toHaveBeenCalled();
  });

  it("unknown user in org-domain mode with non-matching email returns 403", async () => {
    const identities = makeIdentities({});
    const users = makeUsers([]);
    const configStore = makeConfigStore({
      "org.accessControl.mode": JSON.stringify("org-domain"),
      "org.accessControl.orgDomain": JSON.stringify("acme.io"),
    });
    const app = buildApp(stubAuth({ user: { id: "ba-id", email: "outsider@other.com", name: "Out" } }), {
      identities,
      users,
      configStore,
    });

    const res = await app.request("/api/config");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("not provisioned");
  });
});

describe("requireAdmin middleware (wave 3 a6)", () => {
  it("requireAdmin middleware rejects member role", async () => {
    const identities = makeIdentities({ "member@acme.io": "tino-uuid-member" });
    const users = makeUsers([memberUser]);

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use(
      "*",
      buildAuthMiddleware({
        auth: stubAuth({ user: { id: "ba-id", email: "member@acme.io", name: "M" } }),
        allowedDomain: undefined,
        logger: noopLogger(),
        identities,
        users,
      }),
    );
    app.use("/api/admin/*", requireAdmin());
    app.get("/api/admin/action", (c) => c.json({ ok: true }));

    const res = await app.request("/api/admin/action");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("admin role required");
  });

  it("requireAdmin middleware allows admin role", async () => {
    const identities = makeIdentities({ "admin@acme.io": "tino-uuid-admin" });
    const users = makeUsers([adminUser]);

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use(
      "*",
      buildAuthMiddleware({
        auth: stubAuth({ user: { id: "ba-id", email: "admin@acme.io", name: "Admin" } }),
        allowedDomain: undefined,
        logger: noopLogger(),
        identities,
        users,
      }),
    );
    app.use("/api/admin/*", requireAdmin());
    app.get("/api/admin/action", (c) => c.json({ ok: true }));

    const res = await app.request("/api/admin/action");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
