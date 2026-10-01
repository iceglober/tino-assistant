import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { TinoUser } from "../../src/domain/types.js";
import type { AuthVariables } from "../../src/infrastructure/driving/http/auth.js";
import { createUserRoutes } from "../../src/infrastructure/driving/http/routes/users.js";
import type { IdentityStore, UserCapabilityStore, UserStore } from "../../src/ports/outbound.js";
import { makeConfigStore, noopLogger } from "./_helpers.js";

const u = (o: Partial<TinoUser>): TinoUser => ({
  id: "id",
  email: "x@acme.io",
  role: "member",
  status: "active",
  slackUserId: null,
  createdAt: 1,
  updatedAt: 1,
  ...o,
});

function setup(initial: TinoUser[], as: { id: string; role: "admin" | "member" } = { id: "a1", role: "admin" }) {
  const byId = new Map(initial.map((x) => [x.id, x]));
  const users: UserStore = {
    create: vi.fn(async (x: TinoUser) => {
      byId.set(x.id, x);
      return x;
    }),
    get: vi.fn(async (id: string) => byId.get(id) ?? null),
    getByEmail: vi.fn(async (e: string) => [...byId.values()].find((x) => x.email === e) ?? null),
    list: vi.fn(async () => [...byId.values()]),
    update: vi.fn(async (id: string, patch: Partial<TinoUser>) => {
      const next = { ...(byId.get(id) as TinoUser), ...patch };
      byId.set(id, next);
      return next;
    }),
  };
  const identities: IdentityStore = { resolve: vi.fn(), link: vi.fn(), listForUser: vi.fn() };
  const caps = { list: vi.fn(async () => []) } as unknown as UserCapabilityStore;
  const config = makeConfigStore();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", { ...as, email: "a@acme.io", status: "active" });
    await next();
  });
  app.route(
    "/api/users",
    createUserRoutes({ users, identities, userCapabilities: caps, config, logger: noopLogger() }),
  );
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api/users${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call, users, identities, config };
}

describe("/api/users", () => {
  it("is admin-only", async () => {
    const { call } = setup([], { id: "m1", role: "member" });
    expect((await call("GET", "")).status).toBe(403);
  });

  it("invites a user as invited + links their email identity", async () => {
    const { call, users, identities } = setup([u({ id: "a1", role: "admin" })]);
    const res = await call("POST", "", { email: "New@Acme.io", role: "member" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe("invited");
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: "new@acme.io", status: "invited" }));
    expect(identities.link).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "email", externalId: "new@acme.io" }),
    );
  });

  it("rejects inviting an existing account", async () => {
    const { call } = setup([u({ id: "a1", role: "admin", email: "a@acme.io" })]);
    expect((await call("POST", "", { email: "a@acme.io" })).status).toBe(409);
  });

  it("won't demote or suspend the last active admin", async () => {
    const { call } = setup([u({ id: "a1", role: "admin" }), u({ id: "m1" })]);
    expect((await call("PATCH", "/a1", { role: "member" })).status).toBe(409);
    expect((await call("PATCH", "/a1", { status: "suspended" })).status).toBe(409);
  });

  it("suspends a member and promotes another admin", async () => {
    const { call } = setup([u({ id: "a1", role: "admin" }), u({ id: "m1" }), u({ id: "m2" })]);
    expect(((await (await call("PATCH", "/m1", { status: "suspended" })).json()) as { status: string }).status).toBe(
      "suspended",
    );
    expect(((await (await call("PATCH", "/m2", { role: "admin" })).json()) as { role: string }).role).toBe("admin");
    // With two admins, demoting one is fine.
    expect((await call("PATCH", "/a1", { role: "member" })).status).toBe(200);
  });

  it("sets the join policy", async () => {
    const { call } = setup([u({ id: "a1", role: "admin" })]);
    expect(await (await call("PUT", "/access", { mode: "org-domain", domain: "@Acme.io" })).json()).toEqual({
      mode: "org-domain",
      domain: "acme.io",
    });
    expect(((await (await call("PUT", "/access", { mode: "invite-only" })).json()) as { mode: string }).mode).toBe(
      "invite-only",
    );
    expect((await call("PUT", "/access", { mode: "org-domain", domain: "nope" })).status).toBe(400);
  });
});
