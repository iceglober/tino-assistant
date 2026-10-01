import type { TinoUser } from "@tino/core/domain/types";
import type {
  IdentityStore,
  InvitationStore,
  PendingInvitation,
  UserCapabilityStore,
  UserStore,
} from "@tino/core/ports/outbound";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthVariables } from "../../src/infrastructure/driving/http/auth.js";
import { type OrgAdmin, OrgAdminError } from "../../src/infrastructure/driving/http/org-admin.js";
import { createUserRoutes } from "../../src/infrastructure/driving/http/routes/users.js";
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

function setup(
  initial: TinoUser[],
  as: { id: string; role: "owner" | "admin" | "member" } = { id: "a1", role: "admin" },
) {
  const byId = new Map(initial.map((x) => [x.id, x]));
  const users: UserStore = {
    create: vi.fn(),
    get: vi.fn(async (id: string) => byId.get(id) ?? null),
    getByEmail: vi.fn(async (e: string) => [...byId.values()].find((x) => x.email === e) ?? null),
    list: vi.fn(async () => [...byId.values()]),
    update: vi.fn(async (id: string, patch: Partial<TinoUser>) => {
      const next = { ...(byId.get(id) as TinoUser), ...patch };
      byId.set(id, next);
      return next;
    }),
  };
  const pending: PendingInvitation[] = [];
  const invitations: InvitationStore = {
    list: vi.fn(async () => pending),
    pendingFor: vi.fn(async (email: string) => pending.find((p) => p.email === email) ?? null),
    claim: vi.fn(),
  };
  // The org plugin's operations, as the real one would apply them.
  const orgAdmin: OrgAdmin = {
    createOrg: vi.fn(),
    addMember: vi.fn(),
    invite: vi.fn(async (_h, { email, role }) => {
      pending.push({ id: `inv-${email}`, email, role, expiresAt: Date.now() + 1e6, invitedBy: as.id });
    }),
    acceptInvitation: vi.fn(),
    cancelInvitation: vi.fn(async (_h, id: string) => {
      pending.splice(
        pending.findIndex((p) => p.id === id),
        1,
      );
    }),
    updateRole: vi.fn(async (_h, { memberId, role }) => {
      byId.set(memberId, { ...(byId.get(memberId) as TinoUser), role });
    }),
  };
  const identities = { resolve: vi.fn(), link: vi.fn(), listForUser: vi.fn() } as unknown as IdentityStore;
  const caps = {
    list: vi.fn(async () => [{ capabilityId: "gmail", enabled: true }]),
  } as unknown as UserCapabilityStore;
  const config = makeConfigStore();
  const org = {
    org: { id: "o1", name: "Acme", slug: "acme", status: "active" },
    stores: { users, identities, invitations, userCapabilities: caps, config },
  };
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    const coarse = as.role === "member" ? "member" : "admin";
    c.set("user", { id: as.id, email: "a@acme.io", name: null, role: coarse, status: "active", slackUserId: null });
    c.set("role", as.role);
    c.set("org", org as unknown as AuthVariables["org"]);
    await next();
  });
  app.route("/api/users", createUserRoutes({ logger: noopLogger(), orgAdmin }));
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api/users${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call, users, orgAdmin, config, pending };
}

describe("/api/orgs/:slug/users", () => {
  it("shows members a directory without what people connected; admins see it all", async () => {
    const people = [
      u({ id: "a1", role: "admin", email: "a@acme.io", name: "Ada" }),
      u({ id: "m1", email: "bo@acme.io" }),
    ];
    const asMember = await (await setup(people, { id: "m1", role: "member" }).call("GET", "")).json();
    expect(asMember.items[0]).toEqual({ id: "a1", email: "a@acme.io", name: "Ada", role: "admin", status: "active" });
    const asAdmin = await (await setup(people).call("GET", "")).json();
    expect(asAdmin.items[0].connections).toEqual(["gmail"]);
  });

  it("keeps invites, role changes and the join policy to admins", async () => {
    const { call } = setup([u({ id: "a1", role: "admin" })], { id: "m1", role: "member" });
    expect((await call("POST", "", { email: "new@acme.io" })).status).toBe(403);
    expect((await call("PATCH", "/a1", { role: "member" })).status).toBe(403);
    expect((await call("GET", "/access")).status).toBe(403);
  });

  it("invites through the org plugin and lists the pending invitation", async () => {
    const { call, orgAdmin } = setup([u({ id: "a1", role: "admin" })]);
    const res = await call("POST", "", { email: "New@Acme.io", role: "member" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe("invited");
    expect(orgAdmin.invite).toHaveBeenCalledWith(expect.anything(), {
      orgId: "o1",
      email: "new@acme.io",
      role: "member",
    });
    const list = await (await call("GET", "")).json();
    expect(list.items.map((i: { status: string }) => i.status)).toEqual(["active", "invited"]);
    // Cancelling it goes through the plugin too.
    expect((await call("DELETE", "/inv-new@acme.io")).status).toBe(200);
    expect(orgAdmin.cancelInvitation).toHaveBeenCalled();
  });

  it("rejects inviting an existing member, and surfaces the plugin's refusals", async () => {
    const { call, orgAdmin } = setup([u({ id: "a1", role: "admin", email: "a@acme.io" })]);
    expect((await call("POST", "", { email: "a@acme.io" })).status).toBe(409);
    vi.mocked(orgAdmin.invite).mockRejectedValueOnce(new OrgAdminError(403, "you are not allowed to invite"));
    const res = await call("POST", "", { email: "z@acme.io" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "you are not allowed to invite" });
  });

  it("won't demote or suspend the last active admin", async () => {
    const { call } = setup([u({ id: "a1", role: "admin" }), u({ id: "m1" })]);
    expect((await call("PATCH", "/a1", { role: "member" })).status).toBe(409);
    expect((await call("PATCH", "/a1", { status: "suspended" })).status).toBe(409);
  });

  it("suspends a member and promotes another admin", async () => {
    const { call, orgAdmin } = setup([u({ id: "a1", role: "admin" }), u({ id: "m1" }), u({ id: "m2" })]);
    expect(((await (await call("PATCH", "/m1", { status: "suspended" })).json()) as { status: string }).status).toBe(
      "suspended",
    );
    expect(((await (await call("PATCH", "/m2", { role: "admin" })).json()) as { role: string }).role).toBe("admin");
    expect(orgAdmin.updateRole).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", memberId: "m2", role: "admin" });
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

  it("lets owners do what admins do", async () => {
    const { call } = setup([u({ id: "o1", role: "admin", orgRole: "owner" })], { id: "o1", role: "owner" });
    expect((await call("GET", "/access")).status).toBe(200);
  });
});
