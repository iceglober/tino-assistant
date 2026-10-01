import { describe, expect, it } from "vitest";
import {
  clientForRef,
  covers,
  type PlatformOAuthClient,
  type ResolveClientInput,
  resolveOAuthClient,
} from "../../src/domain/oauth-clients.js";

const own = { clientId: "own-id", clientSecret: "own-secret" };
const platform = (p: Partial<PlatformOAuthClient> = {}): PlatformOAuthClient => ({
  clientId: "tino-id",
  clientSecret: "tino-secret",
  approval: "none",
  ...p,
});
const input = (p: Partial<ResolveClientInput> = {}): ResolveClientInput => ({
  capability: "google.gmail",
  orgId: "org-1",
  preference: "auto",
  orgClient: null,
  platformClient: null,
  platformClientUsers: 0,
  ...p,
});

describe("covers", () => {
  it("orders approval levels", () => {
    expect(covers("assessed", "verified")).toBe(true);
    expect(covers("verified", "assessed")).toBe(false);
    expect(covers("none", "none")).toBe(true);
  });
});

describe("resolveOAuthClient", () => {
  it("uses the org's own client by default", () => {
    const r = resolveOAuthClient(input({ orgClient: own, platformClient: platform({ approval: "assessed" }) }));
    expect(r).toMatchObject({ ok: true, ref: { owner: "org", clientId: "own-id" } });
  });

  it("never serves Gmail from an unassessed platform client", () => {
    const r = resolveOAuthClient(input({ platformClient: platform({ approval: "verified" }) }));
    expect(r).toMatchObject({ ok: false, reason: "not_approved" });
  });

  it("serves Calendar from a verified platform client", () => {
    const r = resolveOAuthClient(input({ capability: "google.calendar", platformClient: platform({ approval: "verified" }) }));
    expect(r).toMatchObject({ ok: true, ref: { owner: "platform" }, pilot: false });
  });

  it("serves sign-in from an unverified platform client", () => {
    const r = resolveOAuthClient(input({ capability: "google.signin", platformClient: platform() }));
    expect(r).toMatchObject({ ok: true, ref: { owner: "platform" } });
  });

  it("runs a pilot above approval only under the cap, and says so", () => {
    const pc = platform({ pilot: { userCap: 100 } });
    expect(resolveOAuthClient(input({ platformClient: pc, platformClientUsers: 99 }))).toMatchObject({ ok: true, pilot: true });
    expect(resolveOAuthClient(input({ platformClient: pc, platformClientUsers: 100 }))).toMatchObject({
      ok: false,
      reason: "cap_reached",
    });
  });

  it("honours an allowlist on the platform client", () => {
    const pc = platform({ approval: "assessed", allowedOrgIds: ["org-2"] });
    expect(resolveOAuthClient(input({ platformClient: pc }))).toMatchObject({ ok: false, reason: "not_offered" });
    expect(resolveOAuthClient(input({ platformClient: pc, orgId: "org-2" }))).toMatchObject({ ok: true });
  });

  it("'own' never falls back to the platform client", () => {
    const r = resolveOAuthClient(input({ preference: "own", platformClient: platform({ approval: "assessed" }) }));
    expect(r).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("'managed' prefers the platform client but falls back to the org's own", () => {
    const pc = platform({ approval: "assessed" });
    expect(resolveOAuthClient(input({ preference: "managed", orgClient: own, platformClient: pc }))).toMatchObject({
      ref: { owner: "platform" },
    });
    expect(resolveOAuthClient(input({ preference: "managed", orgClient: own }))).toMatchObject({ ref: { owner: "org" } });
  });
});

describe("clientForRef", () => {
  it("refreshes only against the client that minted the token", () => {
    expect(clientForRef({ owner: "org", clientId: "own-id" }, own, null)).toBe(own);
    expect(clientForRef({ owner: "org", clientId: "rotated-away" }, own, null)).toBeNull();
    expect(clientForRef({ owner: "platform", clientId: "own-id" }, own, null)).toBeNull();
  });
});
