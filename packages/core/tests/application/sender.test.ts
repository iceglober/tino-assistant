import { describe, expect, it, vi } from "vitest";
import { createSenderResolver, type SenderDeps } from "../../src/application/sender.js";
import type { TinoUser } from "../../src/domain/types.js";

const makeUser = (overrides: Partial<TinoUser> = {}): TinoUser => ({
  id: "tino-uuid-1",
  email: "alice@acme.io",
  role: "admin",
  status: "active",
  slackUserId: "U_ALICE",
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const makeDeps = (overrides: Partial<SenderDeps> = {}): SenderDeps => ({
  resolver: {
    resolveSlack: vi.fn().mockResolvedValue(null),
    resolveGoogle: vi.fn().mockResolvedValue(null),
    provisionFromSlack: vi.fn().mockRejectedValue(new Error("unknown_user")),
  },
  users: {
    get: vi.fn().mockResolvedValue(null),
    getByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
  identities: {
    resolve: vi.fn().mockResolvedValue(null),
    link: vi.fn(),
    listForUser: vi.fn().mockResolvedValue([]),
  },
  config: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getTyped: vi.fn(),
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  ...overrides,
});

const fn = (m: unknown): ReturnType<typeof vi.fn> => m as ReturnType<typeof vi.fn>;

describe("createSenderResolver.resolveSlack", () => {
  it("known slack user resolves to their tino user", async () => {
    const deps = makeDeps();
    fn(deps.resolver.resolveSlack).mockResolvedValue("tino-uuid-1");
    fn(deps.users.get).mockResolvedValue(makeUser());

    const result = await createSenderResolver(deps).resolveSlack("U_ALICE");
    expect(result).toEqual({ ok: true, userId: "tino-uuid-1" });
  });

  it("suspended user is rejected with the revocation message", async () => {
    const deps = makeDeps();
    fn(deps.resolver.resolveSlack).mockResolvedValue("tino-uuid-1");
    fn(deps.users.get).mockResolvedValue(makeUser({ status: "suspended" }));

    const result = await createSenderResolver(deps).resolveSlack("U_ALICE");
    expect(result).toEqual({
      ok: false,
      message: "your access to tino has been revoked. ask your admin if this is a mistake.",
    });
  });

  it("invited user is activated on first contact", async () => {
    const deps = makeDeps();
    fn(deps.resolver.resolveSlack).mockResolvedValue("tino-uuid-1");
    fn(deps.users.get).mockResolvedValue(makeUser({ status: "invited" }));

    const result = await createSenderResolver(deps).resolveSlack("U_ALICE");
    expect(result).toEqual({ ok: true, userId: "tino-uuid-1" });
    expect(deps.users.update).toHaveBeenCalledWith("tino-uuid-1", { status: "active" });
  });

  it("unknown user in allowlist mode is rejected", async () => {
    const deps = makeDeps();
    fn(deps.config.get).mockResolvedValue(null);

    const result = await createSenderResolver(deps).resolveSlack("U_STRANGER");
    expect(result).toEqual({ ok: false, message: "i don't recognize you. ask your admin to add you to tino." });
  });

  it("unknown user in org-domain mode with matching email auto-provisions", async () => {
    const deps = makeDeps();
    fn(deps.config.get).mockImplementation(async (key: string) => {
      if (key === "org.accessControl.mode") return JSON.stringify("org-domain");
      if (key === "org.accessControl.orgDomain") return JSON.stringify("acme.io");
      return null;
    });
    fn(deps.resolver.provisionFromSlack).mockResolvedValue(makeUser({ id: "new-uuid", role: "member" }));

    const result = await createSenderResolver(deps).resolveSlack("U_NEWBIE");
    expect(result).toEqual({ ok: true, userId: "new-uuid" });
    expect(deps.resolver.provisionFromSlack).toHaveBeenCalledWith("U_NEWBIE", { mode: "org-domain", orgDomain: "acme.io" });
  });

  it("bootstrap: links a lone unlinked active user when provisioning fails", async () => {
    const deps = makeDeps();
    fn(deps.config.get).mockImplementation(async (key: string) =>
      key === "org.accessControl.mode" ? JSON.stringify("org-domain") : key === "org.accessControl.orgDomain" ? JSON.stringify("acme.io") : null,
    );
    fn(deps.resolver.provisionFromSlack).mockRejectedValue(new Error("unknown_user"));
    fn(deps.users.list).mockResolvedValue([makeUser({ id: "sole", slackUserId: null })]);

    const result = await createSenderResolver(deps).resolveSlack("U_ADMIN");
    expect(result).toEqual({ ok: true, userId: "sole" });
    expect(deps.identities.link).toHaveBeenCalledWith(expect.objectContaining({ provider: "slack", tinoUserId: "sole" }));
  });

  it("zero users — rejects with the setup-needed message", async () => {
    const deps = makeDeps();
    fn(deps.config.get).mockImplementation(async (key: string) =>
      key === "org.accessControl.mode" ? JSON.stringify("org-domain") : key === "org.accessControl.orgDomain" ? JSON.stringify("acme.io") : null,
    );
    fn(deps.resolver.provisionFromSlack).mockRejectedValue(new Error("unknown_user"));
    fn(deps.users.list).mockResolvedValue([]);

    const result = await createSenderResolver(deps).resolveSlack("U_FIRST");
    expect(result).toEqual({ ok: false, message: "tino isn't set up yet. an admin needs to sign in at the console first." });
  });

  it("unknown user with non-matching email (and other users present) is rejected", async () => {
    const deps = makeDeps();
    fn(deps.config.get).mockImplementation(async (key: string) =>
      key === "org.accessControl.mode" ? JSON.stringify("org-domain") : key === "org.accessControl.orgDomain" ? JSON.stringify("acme.io") : null,
    );
    fn(deps.resolver.provisionFromSlack).mockRejectedValue(new Error("unknown_user"));
    fn(deps.users.list).mockResolvedValue([makeUser({ id: "a", slackUserId: "U_A" }), makeUser({ id: "b", slackUserId: "U_B" })]);

    const result = await createSenderResolver(deps).resolveSlack("U_OUTSIDER");
    expect(result).toEqual({
      ok: false,
      message: "i couldn't verify your identity. try signing in at the tino console to connect your Slack account.",
    });
  });
});
