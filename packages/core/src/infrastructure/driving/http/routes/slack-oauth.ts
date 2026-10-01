/**
 * /api/oauth/slack — per-user Slack OAuth (user token).
 *
 * Unlike the Google flow this is NOT console-auth-gated: the bot DMs a connect
 * link carrying a signed connect token, so any workspace member can grant Tino
 * a personal token without logging into the console.
 *
 * GET /authorize?state=<connectToken> — verify the token → tino userId, then
 *   redirect the browser to Slack's OAuth consent for the user scopes below.
 * GET /callback?code&state — verify state → userId, exchange the code for the
 *   user's xoxp token via oauth.v2.access, store it encrypted under the 'slack'
 *   capability, link the Slack identity, and show a success page.
 */
import { webApi } from "@slack/bolt";
import { Hono } from "hono";
import type { ConfigStore, IdentityStore, Logger, UserCapabilityStore } from "../../../../ports/outbound.js";
import type { ConnectTokens } from "../../../security/connect-token.js";

/** Broadest read: the user's DMs, group DMs, private + public channels, and search. */
const USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "search:read",
].join(",");

const successHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Slack connected</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#141c27;color:#f2ebe3;display:flex;height:100vh;margin:0;align-items:center;justify-content:center}
.card{text-align:center}.ok{color:#6aab7a;font-size:2rem}</style></head>
<body><div class="card"><div class="ok">&#10003;</div><h2>Slack connected.</h2>
<p>tino can now read your messages on your behalf. You can close this tab and return to Slack.</p></div></body></html>`;

export function createSlackOAuthRoutes(opts: {
  config: ConfigStore;
  userCapabilities: UserCapabilityStore;
  identities?: IdentityStore;
  connectTokens: ConnectTokens;
  logger: Logger;
  baseUrl: string;
  /** Re-activate KB indexing for this user (fresh consent on reconnect). */
  kbReactivate?: (userId: string, source: "slack" | "gmail") => Promise<void>;
}): Hono {
  const app = new Hono();
  const { config, userCapabilities, identities, connectTokens, logger, baseUrl, kbReactivate } = opts;
  const redirectUri = `${baseUrl}/api/oauth/slack/callback`;

  async function clientCreds(): Promise<{ clientId: string; clientSecret: string } | null> {
    const clientId = (await config.getTyped<string>("slack.clientId", "")) || process.env.SLACK_CLIENT_ID || "";
    const clientSecret = (await config.getTyped<string>("slack.clientSecret", "")) || process.env.SLACK_CLIENT_SECRET || "";
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  app.get("/authorize", async (c) => {
    const state = c.req.query("state") ?? "";
    const userId = connectTokens.verify(state);
    if (!userId) return c.text("This connect link is invalid or expired. DM tino 'connect' for a fresh one.", 400);

    const creds = await clientCreds();
    if (!creds) return c.text("Slack OAuth is not configured on this server yet.", 500);

    const url =
      `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(creds.clientId)}` +
      `&user_scope=${encodeURIComponent(USER_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;
    logger.info({ userId, redirectUri }, "slack oauth authorize redirect");
    return c.redirect(url);
  });

  app.get("/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      logger.warn({ error }, "slack oauth consent denied");
      return c.text(`Slack connect was cancelled (${error}). DM tino 'connect' to try again.`, 200);
    }
    const code = c.req.query("code");
    const state = c.req.query("state") ?? "";
    const userId = connectTokens.verify(state);
    if (!code || !userId) return c.text("This connect link is invalid or expired. DM tino 'connect' for a fresh one.", 400);

    const creds = await clientCreds();
    if (!creds) return c.text("Slack OAuth is not configured on this server yet.", 500);

    try {
      const res = await new webApi.WebClient().oauth.v2.access({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        redirect_uri: redirectUri,
      });
      const userToken = res.authed_user?.access_token;
      const slackUserId = res.authed_user?.id;
      if (!userToken || !slackUserId) {
        logger.error({ userId }, "slack oauth: no user token in response");
        return c.text("Slack didn't return a user token. Make sure the app requests user scopes, then try again.", 500);
      }

      const capConfig = {
        enabled: true,
        credentials: { userToken, slackUserId },
        settings: {},
      };
      await userCapabilities.set(userId, "slack", capConfig);

      // Link the Slack identity to this tino user (ignore if already linked).
      if (identities) {
        await identities
          .link({ provider: "slack", externalId: slackUserId, tinoUserId: userId, linkedAt: Date.now() })
          .catch(() => {});
      }

      await kbReactivate?.(userId, "slack").catch(() => {});
      logger.info({ userId, slackUserId }, "slack oauth connected — user token stored");
      return c.html(successHtml);
    } catch (err) {
      logger.error({ userId, err: (err as Error).message }, "slack oauth token exchange failed");
      return c.text("Something went wrong connecting Slack. DM tino 'connect' to try again.", 500);
    }
  });

  return app;
}
