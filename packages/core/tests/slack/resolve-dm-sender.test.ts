import { describe, expect, it, vi } from "vitest";
import { resolveDmSender, type ResolveDmSenderOpts } from "../../src/slack/resolve-dm-sender.js";
import type { IdentityResolver } from "../../src/identity/resolver.js";
import type { IdentityStore, UserStore } from "../../src/identity/store.js";
import type { TinoUser } from "../../src/identity/types.js";
import type { ConfigStore } from "../../src/persistence/config.js";

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

const makeOpts = (overrides: Partial<ResolveDmSenderOpts> = {}): ResolveDmSenderOpts => ({
  identityResolver: {
    resolveSlack: vi.fn().mockResolvedValue(null),
    resolveGoogle: vi.fn().mockResolvedValue(null),
    provisionFromSlack: vi.fn().mockRejectedValue(new Error("unknown_user")),
  } satisfies IdentityResolver,
  users: {
    get: vi.fn().mockResolvedValue(null),
    getByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  } satisfies UserStore,
  identities: {
    resolve: vi.fn().mockResolvedValue(null),
    link: vi.fn(),
    listForUser: vi.fn().mockResolvedValue([]),
  } satisfies IdentityStore,
  configStore: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getTyped: vi.fn(),
  } as unknown as ConfigStore,
  say: vi.fn().mockResolvedValue(undefined),
  auditLogger: { log: vi.fn().mockResolvedValue(undefined), query: vi.fn(), count: vi.fn(), lastEntryAt: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ResolveDmSenderOpts["logger"],
  ...overrides,
});

describe("resolveDmSender", () => {
  it("known slack user returns tinoUserId", async () => {
    const user = makeUser();
    const opts = makeOpts();
    (opts.identityResolver.resolveSlack as ReturnType<typeof vi.fn>).mockResolvedValue("tino-uuid-1");
    (opts.users.get as ReturnType<typeof vi.fn>).mockResolvedValue(user);

    const result = await resolveDmSender("U_ALICE", opts);

    expect(result).toBe("tino-uuid-1");
    expect(opts.say).not.toHaveBeenCalled();
  });

  it("suspended user is rejected with revocation message", async () => {
    const user = makeUser({ status: "suspended" });
    const opts = makeOpts();
    (opts.identityResolver.resolveSlack as ReturnType<typeof vi.fn>).mockResolvedValue("tino-uuid-1");
    (opts.users.get as ReturnType<typeof vi.fn>).mockResolvedValue(user);

    const result = await resolveDmSender("U_ALICE", opts);

    expect(result).toBeNull();
    expect(opts.say).toHaveBeenCalledWith({
      text: "your access to tino has been revoked. ask your admin if this is a mistake.",
    });
    expect(opts.auditLogger?.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "tino-uuid-1", action: "login", status: "denied", errorMessage: "suspended" }),
    );
  });

  it("invited user is activated on first DM", async () => {
    const user = makeUser({ status: "invited" });
    const opts = makeOpts();
    (opts.identityResolver.resolveSlack as ReturnType<typeof vi.fn>).mockResolvedValue("tino-uuid-1");
    (opts.users.get as ReturnType<typeof vi.fn>).mockResolvedValue(user);

    const result = await resolveDmSender("U_ALICE", opts);

    expect(result).toBe("tino-uuid-1");
    expect(opts.users.update).toHaveBeenCalledWith("tino-uuid-1", { status: "active" });
  });

  it("unknown user in allowlist mode is rejected", async () => {
    const opts = makeOpts();
    (opts.configStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await resolveDmSender("U_STRANGER", opts);

    expect(result).toBeNull();
    expect(opts.say).toHaveBeenCalledWith({
      text: "i don't recognize you. ask your admin to add you to tino.",
    });
    expect(opts.auditLogger?.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "login", status: "denied" }),
    );
  });

  it("unknown user in org-domain mode with matching email auto-provisions", async () => {
    const newUser = makeUser({ id: "new-uuid", role: "member" });
    const opts = makeOpts();
    (opts.configStore.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
      if (key === "org.accessControl.mode") return JSON.stringify("org-domain");
      if (key === "org.accessControl.orgDomain") return JSON.stringify("acme.io");
      return null;
    });
    (opts.identityResolver.provisionFromSlack as ReturnType<typeof vi.fn>).mockResolvedValue(newUser);

    const result = await resolveDmSender("U_NEWBIE", opts);

    expect(result).toBe("new-uuid");
    expect(opts.identityResolver.provisionFromSlack).toHaveBeenCalledWith("U_NEWBIE", {
      mode: "org-domain",
      orgDomain: "acme.io",
    });
    expect(opts.auditLogger?.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "new-uuid", action: "login", status: "success" }),
    );
  });

  it("zero-user bootstrap creates admin from slack DM", async () => {
    const opts = makeOpts();
    (opts.configStore.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
      if (key === "org.accessControl.mode") return JSON.stringify("org-domain");
      if (key === "org.accessControl.orgDomain") return JSON.stringify("acme.io");
      return null;
    });
    (opts.identityResolver.provisionFromSlack as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("unknown_user"),
    );
    (opts.users.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (opts.users.create as ReturnType<typeof vi.fn>).mockImplementation(async (u: TinoUser) => u);

    const result = await resolveDmSender("U_FIRST", opts);

    expect(result).toEqual(expect.any(String));
    expect(opts.users.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin", slackUserId: "U_FIRST", status: "active" }),
    );
    expect(opts.identities.link).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "slack", externalId: "U_FIRST" }),
    );
  });

  it("unknown user in org-domain mode with non-matching email is rejected", async () => {
    const existingUser = makeUser({ id: "existing-admin", slackUserId: "U_EXISTING" });
    const opts = makeOpts();
    (opts.configStore.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
      if (key === "org.accessControl.mode") return JSON.stringify("org-domain");
      if (key === "org.accessControl.orgDomain") return JSON.stringify("acme.io");
      return null;
    });
    (opts.identityResolver.provisionFromSlack as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("unknown_user"),
    );
    (opts.users.list as ReturnType<typeof vi.fn>).mockResolvedValue([existingUser]);

    const result = await resolveDmSender("U_OUTSIDER", opts);

    expect(result).toBeNull();
    expect(opts.say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("don't recognize you"),
      }),
    );
    expect(opts.auditLogger?.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "login", status: "denied", errorMessage: "unknown_user" }),
    );
  });
});
