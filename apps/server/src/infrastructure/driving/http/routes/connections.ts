/**
 * Connecting Google and Slack — for an org (its Slack app) and for a person
 * (their mail, calendar, and Slack token).
 *
 * Org-scoped (mounted under /api/orgs/:slug):
 *   GET    /connections/google/start?access=mail|calendar  → 302 to Google consent
 *   GET    /connections/slack/start                        → 302 to Slack consent (personal token)
 *   DELETE /connections/:provider                          → forget my google|slack token
 *   GET    /google/setup                                   → what the org's own client needs (admin)
 *   GET    /slack/setup                                    → manifest + create link + what's saved (admin)
 *   POST   /slack/install                                  → { url } to install the org's app (admin)
 *
 * Callbacks (mounted under /api/oauth — one redirect URI per provider for every org):
 *   GET /google/callback, GET /slack/callback, and GET /slack/connect?state=
 *   (the link the bot DMs: starts a personal Slack connect without a console session).
 *
 * Which OAuth client is used comes from the org's settings via the policy in
 * domain/oauth-clients.ts; the signed state records it so the callback
 * finishes with the same client. Every callback is bound to the person who
 * started it — by console session, or for a bot link by the Slack identity
 * coming back — so nobody can attach their consent to someone else's account.
 */
import { webApi } from "@slack/bolt";
import type { GoogleSetup, InstallStart, ResolutionView, SlackSetup } from "@tino/contracts";
import type { ClientResolution, OAuthClientCredentials, PlatformOAuthClient } from "@tino/core/domain/oauth-clients";
import type { Logger, OrgStore } from "@tino/core/ports/outbound";
import { google } from "googleapis";
import { type Context, Hono } from "hono";
import type { OrgRuntime } from "../../../../bootstrap/org-runtime.js";
import {
  buildSlackManifest,
  slackAuthorizeUrl,
  slackCreateAppUrl,
  slackEventsUrl,
  slackRedirectUrl,
} from "../../../driven/slack/manifest.js";
import type { OAuthState, SignedState } from "../../../security/signed-state.js";
import { type AccountVariables, type AuthVariables, authorize } from "../auth.js";

const GOOGLE_SCOPES = {
  identity: "https://www.googleapis.com/auth/userinfo.email",
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
};

export interface ConnectionDeps {
  baseUrl: string;
  state: SignedState;
  orgs: OrgStore;
  runtime: (orgId: string) => Promise<OrgRuntime | null>;
  refresh: (orgId: string) => Promise<void>;
  platformClients: { google: PlatformOAuthClient | null; slack: PlatformOAuthClient | null };
  logger: Logger;
}

const googleRedirect = (baseUrl: string) => `${baseUrl}/api/oauth/google/callback`;

const view = (r: ClientResolution): ResolutionView =>
  r.ok ? { ok: true, client: r.ref.owner, pilot: r.pilot } : { ok: false, reason: r.reason, message: r.message };

/** The org's Slack app: whose client it is and its credentials, once installed (or being installed). */
async function slackClientFor(
  rt: OrgRuntime,
  owner: "org" | "platform",
  platform: PlatformOAuthClient | null,
): Promise<OAuthClientCredentials | null> {
  return owner === "org" ? rt.oauth.own("slack") : platform;
}

async function slackOwner(rt: OrgRuntime): Promise<"org" | "platform" | null> {
  const owner = await rt.stores.config.getTyped<string>("slack.clientOwner", "");
  return owner === "org" || owner === "platform" ? owner : null;
}

// ── Org-scoped ────────────────────────────────────────────────────────────────

export function createOrgConnectionRoutes(deps: ConnectionDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { baseUrl, state, logger } = deps;
  const back = (c: Context<{ Variables: AuthVariables }>, q: string) =>
    c.redirect(`${baseUrl}/${c.get("org").org.slug}/connections?${q}`);

  app.get("/connections/google/start", async (c) => {
    const rt = c.get("org");
    const me = c.get("user");
    const calendarOnly = c.req.query("access") === "calendar";
    const resolution = await rt.oauth.resolve(calendarOnly ? "google.calendar" : "google.gmail");
    if (!resolution.ok) return back(c, `error=${encodeURIComponent(resolution.message)}`);

    const oauth2 = new google.auth.OAuth2(
      resolution.credentials.clientId,
      resolution.credentials.clientSecret,
      googleRedirect(baseUrl),
    );
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: calendarOnly
        ? [GOOGLE_SCOPES.identity, GOOGLE_SCOPES.calendar]
        : [GOOGLE_SCOPES.identity, GOOGLE_SCOPES.gmail, GOOGLE_SCOPES.calendar],
      state: state.issue({ orgId: rt.org.id, userId: me.id, purpose: "google.connect", client: resolution.ref.owner }),
    });
    logger.info(
      { org: rt.org.slug, userId: me.id, client: resolution.ref.owner, calendarOnly },
      "google connect started",
    );
    return c.redirect(url);
  });

  app.get("/connections/slack/start", async (c) => {
    const rt = c.get("org");
    const owner = await slackOwner(rt);
    const client = owner ? await slackClientFor(rt, owner, deps.platformClients.slack) : null;
    if (!owner || !client || !rt.org.slackTeamId) {
      return back(c, `error=${encodeURIComponent("Slack isn't installed for this org yet — ask an admin")}`);
    }
    const token = state.issue({ orgId: rt.org.id, userId: c.get("user").id, purpose: "slack.connect", client: owner });
    return c.redirect(
      slackAuthorizeUrl({ clientId: client.clientId, baseUrl, state: token, bot: false, teamId: rt.org.slackTeamId }),
    );
  });

  app.delete("/connections/:provider", async (c) => {
    const rt = c.get("org");
    const me = c.get("user");
    const provider = c.req.param("provider");
    const caps = rt.stores.userCapabilities;
    if (provider === "google") {
      await caps.delete(me.id, "gmail");
      await caps.delete(me.id, "calendar");
    } else if (provider === "slack") {
      await caps.delete(me.id, "slack");
    } else {
      return c.json({ error: "provider must be google or slack" }, 400);
    }
    logger.info({ org: rt.org.slug, userId: me.id, provider }, "connection removed");
    return c.json({ ok: true });
  });

  app.get("/google/setup", authorize("read", "googleClient"), async (c) => {
    const rt = c.get("org");
    const { config } = rt.stores;
    const [mail, calendar] = await Promise.all([rt.oauth.resolve("google.gmail"), rt.oauth.resolve("google.calendar")]);
    const body: GoogleSetup = {
      redirectUrl: googleRedirect(baseUrl),
      scopes: [GOOGLE_SCOPES.identity, GOOGLE_SCOPES.gmail, GOOGLE_SCOPES.calendar],
      saved: {
        clientId: !!(await config.get("google.oauth.clientId")),
        clientSecret: !!(await config.get("google.oauth.clientSecret")),
      },
      resolution: { mail: view(mail), calendar: view(calendar) },
    };
    return c.json(body);
  });

  app.get("/slack/setup", authorize("read", "slackApp"), async (c) => {
    const rt = c.get("org");
    const { config } = rt.stores;
    const manifest = buildSlackManifest({ orgId: rt.org.id, baseUrl });
    const managed = await rt.oauth.resolve("slack");
    const body: SlackSetup = {
      manifest,
      createUrl: slackCreateAppUrl(manifest),
      eventsUrl: slackEventsUrl(baseUrl, rt.org.id),
      redirectUrl: slackRedirectUrl(baseUrl),
      saved: {
        clientId: !!(await config.get("slack.clientId")),
        clientSecret: !!(await config.get("slack.clientSecret")),
        signingSecret: !!(await config.get("slack.signingSecret")),
      },
      installed: rt.slackApp() !== null,
      teamId: rt.org.slackTeamId,
      managedAvailable: managed.ok && managed.ref.owner === "platform",
    };
    return c.json(body);
  });

  app.post("/slack/install", authorize("create", "slackApp"), async (c) => {
    const rt = c.get("org");
    const resolution = await rt.oauth.resolve("slack");
    if (!resolution.ok) return c.json({ error: resolution.reason, message: resolution.message }, 409);
    if (resolution.ref.owner === "org" && !(await rt.stores.config.get("slack.signingSecret"))) {
      return c.json(
        {
          error: "not_configured",
          message: "save your Slack app's signing secret first — events can't be verified without it",
        },
        409,
      );
    }
    const token = state.issue({
      orgId: rt.org.id,
      userId: c.get("user").id,
      purpose: "slack.install",
      client: resolution.ref.owner,
    });
    const body: InstallStart = {
      url: slackAuthorizeUrl({ clientId: resolution.credentials.clientId, baseUrl, state: token, bot: true }),
    };
    return c.json(body);
  });

  return app;
}

// ── Callbacks ─────────────────────────────────────────────────────────────────

const page = (title: string, message: string, ok: boolean) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#141c27;color:#f2ebe3;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;padding:16px}
.card{max-width:420px;text-align:center}.mark{font-size:2rem;color:${ok ? "#6aab7a" : "#d9826b"}}</style></head>
<body><div class="card"><div class="mark">${ok ? "&#10003;" : "&#33;"}</div><h2>${title}</h2><p>${message}</p></div></body></html>`;

export function createOAuthCallbackRoutes(deps: ConnectionDeps): Hono<{ Variables: AccountVariables }> {
  const app = new Hono<{ Variables: AccountVariables }>();
  const { baseUrl, state, orgs, logger } = deps;
  const toConnections = (slug: string, q: string) => `${baseUrl}/${slug}/connections?${q}`;

  /** The member a state names, and whether the signed-in account is that member. */
  async function load(st: OAuthState, account: AccountVariables["account"]) {
    const rt = await deps.runtime(st.orgId);
    const member = rt ? await rt.stores.users.get(st.userId) : null;
    if (!rt || !member || member.status === "suspended") return null;
    return { rt, member, sessionMatches: !!account && account.email === member.email.toLowerCase() };
  }

  app.get("/google/callback", async (c) => {
    const st = state.verify(c.req.query("state") ?? "");
    if (!st || st.purpose !== "google.connect")
      return c.html(page("Link expired", "Start again from Tino.", false), 400);
    const ctx = await load(st, c.get("account"));
    if (!ctx) return c.html(page("Not available", "This connection can't be completed.", false), 400);
    const { rt, member } = ctx;
    const slug = rt.org.slug;
    if (c.req.query("error")) return c.redirect(toConnections(slug, "error=cancelled"));
    // Google connects only start from the console, so the session must be the person who started it.
    if (!ctx.sessionMatches) return c.redirect(toConnections(slug, "error=session_mismatch"));

    const client = st.client === "org" ? await rt.oauth.own("google") : deps.platformClients.google;
    if (!client) return c.redirect(toConnections(slug, "error=client_changed"));
    try {
      const oauth2 = new google.auth.OAuth2(client.clientId, client.clientSecret, googleRedirect(baseUrl));
      const { tokens } = await oauth2.getToken(c.req.query("code") ?? "");
      if (!tokens.refresh_token) return c.redirect(toConnections(slug, "error=no_refresh_token"));
      const granted = new Set((tokens.scope ?? "").split(/\s+/));
      const ref = { owner: st.client, clientId: client.clientId };
      const caps = rt.stores.userCapabilities;
      if (granted.has(GOOGLE_SCOPES.gmail)) {
        await caps.set(member.id, "gmail", {
          enabled: true,
          credentials: { refreshToken: tokens.refresh_token },
          settings: { client: ref },
        });
        await rt
          .kb()
          ?.reactivate(member.id, "gmail")
          .catch(() => {});
      }
      if (granted.has(GOOGLE_SCOPES.calendar)) {
        await caps.set(member.id, "calendar", {
          enabled: true,
          credentials: { refreshToken: tokens.refresh_token },
          settings: { client: ref, calendarId: "primary" },
        });
      }
      logger.info({ org: slug, userId: member.id, client: st.client, scopes: [...granted].length }, "google connected");
      return c.redirect(toConnections(slug, "connected=google"));
    } catch (err) {
      logger.error({ org: slug, userId: member.id, err: (err as Error).message }, "google token exchange failed");
      return c.redirect(toConnections(slug, "error=exchange_failed"));
    }
  });

  // The bot's "connect" link: re-issue the state with the org's actual Slack client, then go to Slack.
  app.get("/slack/connect", async (c) => {
    const st = state.verify(c.req.query("state") ?? "");
    if (!st || st.purpose !== "slack.connect") {
      return c.html(page("Link expired", "DM tino “connect” for a fresh link.", false), 400);
    }
    const ctx = await load(st, c.get("account"));
    const owner = ctx ? await slackOwner(ctx.rt) : null;
    const client = ctx && owner ? await slackClientFor(ctx.rt, owner, deps.platformClients.slack) : null;
    if (!ctx || !owner || !client) return c.html(page("Not available", "Slack isn't set up for this org.", false), 400);
    const token = state.issue({ ...st, client: owner });
    return c.redirect(
      slackAuthorizeUrl({
        clientId: client.clientId,
        baseUrl,
        state: token,
        bot: false,
        teamId: ctx.rt.org.slackTeamId,
      }),
    );
  });

  app.get("/slack/callback", async (c) => {
    const st = state.verify(c.req.query("state") ?? "");
    if (!st || (st.purpose !== "slack.connect" && st.purpose !== "slack.install")) {
      return c.html(page("Link expired", "Start again from Tino.", false), 400);
    }
    const ctx = await load(st, c.get("account"));
    if (!ctx) return c.html(page("Not available", "This connection can't be completed.", false), 400);
    const { rt, member } = ctx;
    const slug = rt.org.slug;
    if (c.req.query("error")) {
      return st.purpose === "slack.install"
        ? c.redirect(`${baseUrl}/${slug}/settings/slack?error=cancelled`)
        : c.html(page("Cancelled", "Nothing was connected. DM tino “connect” to try again.", false));
    }
    const client = await slackClientFor(rt, st.client, deps.platformClients.slack);
    if (!client) return c.html(page("Not available", "Slack isn't set up for this org.", false), 400);

    let res: Awaited<ReturnType<webApi.WebClient["oauth"]["v2"]["access"]>>;
    try {
      res = await new webApi.WebClient().oauth.v2.access({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code: c.req.query("code") ?? "",
        redirect_uri: slackRedirectUrl(baseUrl),
      });
    } catch (err) {
      logger.error({ org: slug, err: (err as Error).message }, "slack token exchange failed");
      return c.html(page("Something went wrong", "Slack didn't accept the request. Try again.", false), 500);
    }
    const teamId = res.team?.id ?? null;
    const slackUserId = res.authed_user?.id ?? null;
    const userToken = res.authed_user?.access_token ?? null;
    const { config, users, identities, userCapabilities } = rt.stores;

    /** Store a person's own token and link their Slack identity — refusing one already linked to someone else. */
    const connectPerson = async (): Promise<string | null> => {
      if (!slackUserId || !userToken) return "Slack didn't return a user token";
      const linked = await identities.resolve("slack", slackUserId);
      if (linked && linked !== member.id) return "that Slack account is already linked to someone else in this org";
      await userCapabilities.set(member.id, "slack", {
        enabled: true,
        credentials: { userToken, slackUserId },
        settings: {},
      });
      if (!linked)
        await identities.link({
          provider: "slack",
          externalId: slackUserId,
          tinoUserId: member.id,
          linkedAt: Date.now(),
        });
      if (member.slackUserId !== slackUserId) await users.update(member.id, { slackUserId });
      await rt
        .kb()
        ?.reactivate(member.id, "slack")
        .catch(() => {});
      return null;
    };

    if (st.purpose === "slack.install") {
      const settings = `${baseUrl}/${slug}/settings/slack`;
      if (!ctx.sessionMatches || member.role !== "admin") return c.redirect(`${settings}?error=session_mismatch`);
      if (!teamId || !res.access_token) return c.redirect(`${settings}?error=no_bot_token`);
      const holder = await orgs.getBySlackTeam(teamId);
      if (holder && holder.id !== rt.org.id) return c.redirect(`${settings}?error=team_taken`);
      if (rt.org.slackTeamId && rt.org.slackTeamId !== teamId) return c.redirect(`${settings}?error=other_team`);

      await config.set("slack.botToken", res.access_token);
      await config.set("slack.clientOwner", st.client);
      if (res.bot_user_id) await config.set("slack.botUserId", res.bot_user_id);
      await orgs.update(rt.org.id, { slackTeamId: teamId });
      const personal = await connectPerson();
      await deps.refresh(rt.org.id);
      logger.info({ org: slug, teamId, client: st.client }, "slack app installed");
      return c.redirect(`${settings}?installed=1${personal ? `&warning=${encodeURIComponent(personal)}` : ""}`);
    }

    // Personal connect. A member already linked to Slack must come back as that same Slack
    // user; anyone else must be signed in to the console as themselves.
    if (teamId !== rt.org.slackTeamId) {
      return c.html(page("Wrong workspace", "Connect the Slack workspace this org uses.", false), 400);
    }
    const sameSlackUser = !!member.slackUserId && member.slackUserId === slackUserId;
    if (!sameSlackUser && !ctx.sessionMatches) {
      logger.warn({ org: slug, userId: member.id }, "slack connect refused: started by a different person");
      return c.html(
        page("Not your link", "This connect link belongs to someone else. DM tino “connect” for your own.", false),
        403,
      );
    }
    const problem = await connectPerson();
    if (problem) return c.html(page("Couldn't connect", problem, false), 400);
    logger.info({ org: slug, userId: member.id }, "slack connected");
    return ctx.sessionMatches
      ? c.redirect(toConnections(slug, "connected=slack"))
      : c.html(
          page("Slack connected", "Tino can now read your messages on your behalf. You can close this tab.", true),
        );
  });

  return app;
}

/** The link the bot DMs for "connect": signed for this member, finished by /api/oauth/slack/connect. */
export function slackConnectLink(state: SignedState, baseUrl: string, orgId: string, userId: string): string {
  const token = state.issue({ orgId, userId, purpose: "slack.connect", client: "org" });
  return `${baseUrl}/api/oauth/slack/connect?state=${encodeURIComponent(token)}`;
}
