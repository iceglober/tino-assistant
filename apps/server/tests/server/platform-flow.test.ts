/**
 * The managed service end to end over HTTP: sign up, create an org, configure
 * it, invite someone, and prove members of one org can't reach another's.
 */
import crypto from "node:crypto";
import type { Me, OrgOverview, OrgSummary, SettingsView, SlackSetup } from "@tino/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, testApp } from "./_app.js";

let t: Awaited<ReturnType<typeof testApp>>;
let ada: ReturnType<typeof t.person>;
let acme: OrgSummary;

beforeAll(async () => {
  t = await testApp();
  ada = t.person();
  await ada.signUp("ada@acme.io", "Ada");
  acme = (await ada.json<OrgSummary>("POST", "/api/orgs", { name: "Acme Inc" })).body;
});
afterAll(async () => {
  await t.close();
});

describe("accounts and orgs", () => {
  it("rejects anonymous requests", async () => {
    expect((await t.person().request("GET", "/api/me")).status).toBe(401);
    expect((await t.person().request("GET", "/api/orgs/acme-inc")).status).toBe(401);
  });

  it("creates an org with the creator as its admin", async () => {
    expect(acme.slug).toBe("acme-inc");
    const me = await ada.json<Me>("GET", "/api/me");
    expect(me.body.memberships).toEqual([{ org: acme, role: "admin", status: "active" }]);
    const overview = await ada.json<OrgOverview>("GET", "/api/orgs/acme-inc");
    expect(overview.body.me).toMatchObject({ email: "ada@acme.io", role: "admin" });
    expect(overview.body.status.model).toBe(false);
  });

  it("checks slugs and refuses taken or reserved ones", async () => {
    expect((await ada.json("GET", "/api/orgs/slug-available?slug=acme-inc")).body).toMatchObject({ available: false });
    expect((await ada.json("GET", "/api/orgs/slug-available?slug=api")).body).toMatchObject({ available: false });
    expect((await ada.json("GET", "/api/orgs/slug-available?slug=fresh-co")).body).toMatchObject({ available: true });
    expect((await ada.request("POST", "/api/orgs", { name: "Acme", slug: "acme-inc" })).status).toBe(409);
  });
});

describe("settings", () => {
  it("stores secrets write-only and rejects unknown keys", async () => {
    const put = await ada.json("PUT", "/api/orgs/acme-inc/settings", {
      values: { "model.provider": "openai", "openai.apiKey": "sk-test-123", "openai.model": "gpt-x" },
    });
    expect(put.status).toBe(200);
    const view = await ada.json<SettingsView>("GET", "/api/orgs/acme-inc/settings");
    expect(view.body.values["model.provider"]).toBe("openai");
    expect(view.body.secrets["openai.apiKey"]).toBe(true);
    expect(JSON.stringify(view.body)).not.toContain("sk-test-123");
    expect(
      (await ada.request("PUT", "/api/orgs/acme-inc/settings", { values: { "connect.secret": "x" } })).status,
    ).toBe(400);
  });

  it("applies settings: the model comes up", async () => {
    const res = await ada.json<{ ok: boolean; status: { model: boolean } }>(
      "POST",
      "/api/orgs/acme-inc/settings/apply",
    );
    expect(res.body).toMatchObject({ ok: true, status: { model: true } });
  });
});

describe("members", () => {
  it("invites someone, who becomes an active member on first sign-in", async () => {
    const res = await ada.json("POST", "/api/orgs/acme-inc/users", { email: "bo@acme.io", role: "member" });
    expect(res.status).toBe(201);
    expect(t.sent.some((m) => m.to === "bo@acme.io")).toBe(true);

    const bo = t.person();
    await bo.signUp("bo@acme.io", "Bo");
    const me = await bo.json<Me>("GET", "/api/me");
    expect(me.body.memberships[0]).toMatchObject({ org: { slug: "acme-inc" }, status: "invited" });
    const overview = await bo.json<OrgOverview>("GET", "/api/orgs/acme-inc");
    expect(overview.body.me).toMatchObject({ role: "member", status: "active", name: "Bo" });
    // Members don't see settings or the member list.
    expect((await bo.request("GET", "/api/orgs/acme-inc/settings")).status).toBe(403);
    expect((await bo.request("GET", "/api/orgs/acme-inc/users")).status).toBe(403);
  });

  it("lets people on the org's domain join once the admin allows it", async () => {
    const cy = t.person();
    await cy.signUp("cy@acme.io");
    expect((await cy.json<Me>("GET", "/api/me")).body.joinable).toEqual([]);
    await ada.json("PUT", "/api/orgs/acme-inc/users/access", { mode: "org-domain", domain: "acme.io" });
    expect((await cy.json<Me>("GET", "/api/me")).body.joinable.map((o) => o.slug)).toEqual(["acme-inc"]);
    expect((await cy.request("POST", "/api/orgs/acme-inc/join")).status).toBe(201);
    expect((await cy.json<OrgOverview>("GET", "/api/orgs/acme-inc")).body.me.role).toBe("member");

    const eve = t.person();
    await eve.signUp("eve@elsewhere.com");
    expect((await eve.request("POST", "/api/orgs/acme-inc/join")).status).toBe(404);
  });
});

describe("isolation between orgs", () => {
  it("a member of one org can't see or touch another", async () => {
    const zed = t.person();
    await zed.signUp("zed@globex.com");
    const globex = (await zed.json<OrgSummary>("POST", "/api/orgs", { name: "Globex" })).body;

    for (const path of ["", "/settings", "/users", "/kb/status", "/mcp/servers"]) {
      expect((await zed.request("GET", `/api/orgs/acme-inc${path}`)).status).toBe(404);
      expect((await ada.request("GET", `/api/orgs/${globex.slug}${path}`)).status).toBe(404);
    }
    expect(
      (await zed.request("PUT", "/api/orgs/acme-inc/settings", { values: { "model.provider": "x" } })).status,
    ).toBe(404);
    expect((await zed.request("POST", "/api/orgs/acme-inc/chat", { text: "hi" })).status).toBe(404);
    // Globex's settings are its own.
    expect(
      (await zed.json<SettingsView>("GET", `/api/orgs/${globex.slug}/settings`)).body.secrets["openai.apiKey"],
    ).toBe(false);
  });
});

describe("slack", () => {
  const sign = (secret: string, body: string, ts = Math.floor(Date.now() / 1000)) => ({
    "x-slack-request-timestamp": String(ts),
    "x-slack-signature": `v0=${crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`,
    "content-type": "application/json",
  });

  it("generates the org's manifest pointing at its own events URL", async () => {
    const setup = await ada.json<SlackSetup>("GET", "/api/orgs/acme-inc/slack/setup");
    expect(setup.body.eventsUrl).toBe(`${BASE}/slack/events/${acme.id}`);
    expect(setup.body.createUrl).toContain("https://api.slack.com/apps?new_app=1&manifest_json=");
    const manifest = setup.body.manifest as { settings: { event_subscriptions: { request_url: string } } };
    expect(manifest.settings.event_subscriptions.request_url).toBe(setup.body.eventsUrl);
    expect(setup.body.saved).toEqual({ clientId: false, clientSecret: false, signingSecret: false });
  });

  it("won't start an install without the app's signing secret", async () => {
    await ada.json("PUT", "/api/orgs/acme-inc/settings", {
      values: { "slack.clientId": "123.456", "slack.clientSecret": "cs" },
    });
    expect((await ada.request("POST", "/api/orgs/acme-inc/slack/install")).status).toBe(409);
    await ada.json("PUT", "/api/orgs/acme-inc/settings", { values: { "slack.signingSecret": "signing-secret" } });
    const res = await ada.json<{ url: string }>("POST", "/api/orgs/acme-inc/slack/install");
    const url = new URL(res.body.url);
    expect(url.host).toBe("slack.com");
    expect(url.searchParams.get("client_id")).toBe("123.456");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/oauth/slack/callback`);
    expect(t.state.verify(url.searchParams.get("state") ?? "")).toMatchObject({
      purpose: "slack.install",
      client: "org",
    });
  });

  it("verifies event signatures with the org's signing secret", async () => {
    const challenge = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const anon = t.person();
    const good = await anon.request("POST", `/slack/events/${acme.id}`, challenge, sign("signing-secret", challenge));
    expect(await good.json()).toEqual({ challenge: "abc" });
    const forged = await anon.request("POST", `/slack/events/${acme.id}`, challenge, sign("not-the-secret", challenge));
    expect(forged.status).toBe(401);
    const stale = await anon.request(
      "POST",
      `/slack/events/${acme.id}`,
      challenge,
      sign("signing-secret", challenge, Math.floor(Date.now() / 1000) - 3600),
    );
    expect(stale.status).toBe(401);
  });
});

describe("google", () => {
  it("sends members to their org's own client, and says why when there is none", async () => {
    const none = await ada.request("GET", "/api/orgs/acme-inc/connections/google/start");
    expect(none.status).toBe(302);
    expect(none.headers.get("location")).toContain("/acme-inc/connections?error=");

    await ada.json("PUT", "/api/orgs/acme-inc/settings", {
      values: { "google.oauth.clientId": "gid.apps.googleusercontent.com", "google.oauth.clientSecret": "gsecret" },
    });
    const res = await ada.request("GET", "/api/orgs/acme-inc/connections/google/start");
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.host).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("gid.apps.googleusercontent.com");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(t.state.verify(url.searchParams.get("state") ?? "")).toMatchObject({
      purpose: "google.connect",
      client: "org",
    });

    const cal = await ada.request("GET", "/api/orgs/acme-inc/connections/google/start?access=calendar");
    expect(new URL(cal.headers.get("location") ?? "").searchParams.get("scope")).not.toContain("gmail");
  });

  it("refuses a callback finished by someone other than who started it", async () => {
    const overview = await ada.json<OrgOverview>("GET", "/api/orgs/acme-inc");
    const state = t.state.issue({
      orgId: acme.id,
      userId: overview.body.me.id,
      purpose: "google.connect",
      client: "org",
    });
    const mallory = t.person();
    await mallory.signUp("mallory@acme.io");
    const res = await mallory.request("GET", `/api/oauth/google/callback?code=x&state=${encodeURIComponent(state)}`);
    expect(res.headers.get("location")).toContain("error=session_mismatch");
  });
});

describe("closed beta", () => {
  it("only allowlisted addresses create orgs; invited people still get in", async () => {
    const closed = await testApp({ signups: "closed", canCreateOrg: (e) => e.endsWith("@tino.app") });
    try {
      const stranger = closed.person();
      await stranger.signUp("stranger@nowhere.io");
      expect((await stranger.json<Me>("GET", "/api/me")).body.canCreateOrg).toBe(false);
      expect((await stranger.json("POST", "/api/orgs", { name: "Nope" })).status).toBe(403);

      const founder = closed.person();
      await founder.signUp("founder@tino.app");
      expect((await founder.json("POST", "/api/orgs", { name: "Pilot Co" })).status).toBe(201);
      await founder.json("POST", "/api/orgs/pilot-co/users", { email: "stranger@nowhere.io", role: "member" });
      expect((await stranger.request("GET", "/api/orgs/pilot-co")).status).toBe(200);
    } finally {
      await closed.close();
    }
  }, 30_000);
});
