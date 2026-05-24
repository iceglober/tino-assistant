import { Hono } from "hono";
import { google } from "googleapis";
import type { ConfigStore } from "../../persistence/config.js";
import type { UserCapabilityStore } from "../../persistence/user-capabilities.js";
import type { AuditLogger } from "../../audit/logger.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
];

/**
 * /api/oauth/google — in-app Google OAuth consent flow.
 *
 * GET /authorize — generates consent URL and redirects the browser to Google.
 *   Uses the same GOOGLE_OAUTH_CLIENT_ID / SECRET as better-auth SSO, but
 *   requests Gmail + Calendar scopes for capability credentials.
 *   Stores a CSRF `state` token so the callback can verify the round-trip.
 *
 * GET /callback — receives the auth code from Google, exchanges it for tokens,
 *   stores the refresh token in the user's per-user capability config (both
 *   gmail and calendar), then redirects back to the console.
 */
export function createGoogleOAuthRoutes(opts: {
  config: ConfigStore;
  userCapabilities?: UserCapabilityStore;
  logger: AppLogger;
  auditLogger?: AuditLogger;
  baseUrl: string;
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { config, userCapabilities, logger, auditLogger, baseUrl } = opts;

  const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

  async function getOAuth2Client(): Promise<InstanceType<typeof google.auth.OAuth2> | null> {
    let clientId = await config.getTyped<string>("google.oauth.clientId", "");
    let clientSecret = await config.getTyped<string>("google.oauth.clientSecret", "");
    if (!clientId) clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
    if (!clientSecret) clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) return null;
    return new google.auth.OAuth2(clientId, clientSecret, `${baseUrl}/api/oauth/google/callback`);
  }

  app.get("/authorize", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const oauth2 = await getOAuth2Client();
    if (!oauth2) {
      return c.json({ error: "Google OAuth not configured on this server" }, 500);
    }

    const state = crypto.randomUUID();
    pendingStates.set(state, { userId: user.id, expiresAt: Date.now() + 10 * 60 * 1000 });

    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES,
      state,
      include_granted_scopes: true,
    });

    logger.info({ redirectUri: `${baseUrl}/api/oauth/google/callback`, generatedUrl: url }, "Google OAuth authorize redirect");
    return c.redirect(url);
  });

  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      logger.warn({ error }, "Google OAuth consent denied");
      return c.redirect("/?oauth=denied");
    }

    if (!code || !state) {
      return c.redirect("/?oauth=error");
    }

    const pending = pendingStates.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingStates.delete(state ?? "");
      return c.redirect("/?oauth=expired");
    }
    pendingStates.delete(state);

    const user = c.get("user");
    if (!user || user.id !== pending.userId) {
      return c.redirect("/?oauth=mismatch");
    }

    const oauth2 = await getOAuth2Client();
    if (!oauth2) {
      return c.redirect("/?oauth=error");
    }

    try {
      const { tokens } = await oauth2.getToken(code);
      if (!tokens.refresh_token) {
        logger.warn({ userId: user.id }, "Google OAuth: no refresh token returned — user may need to revoke and reconnect");
        return c.redirect("/?oauth=no_refresh_token");
      }

      let clientId = await config.getTyped<string>("google.oauth.clientId", "");
      let clientSecret = await config.getTyped<string>("google.oauth.clientSecret", "");
      if (!clientId) clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
      if (!clientSecret) clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";

      const capConfig = {
        enabled: true,
        credentials: { clientId, clientSecret, refreshToken: tokens.refresh_token },
        settings: {},
      };

      const calConfig = {
        enabled: true,
        credentials: { clientId, clientSecret, refreshToken: tokens.refresh_token },
        settings: { calendarId: "primary" },
      };

      if (userCapabilities) {
        await userCapabilities.set(user.id, "gmail", capConfig);
        await userCapabilities.set(user.id, "calendar", calConfig);
      } else {
        await config.set(`user.${user.id}.capability.gmail`, capConfig);
        await config.set(`user.${user.id}.capability.calendar`, calConfig);
      }

      if (auditLogger) {
        await auditLogger.log({
          userId: user.email,
          action: "config_change",
          toolName: "google",
          status: "success",
        });
      }

      logger.info({ userId: user.id, email: user.email }, "Google OAuth connected — gmail + calendar capabilities stored");
      return c.redirect("/?oauth=success");
    } catch (err) {
      logger.error({ userId: user.id, err: (err as Error).message }, "Google OAuth token exchange failed");
      return c.redirect("/?oauth=error");
    }
  });

  // Evict expired states periodically (in-memory; acceptable for single-instance)
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pendingStates) {
      if (val.expiresAt < now) pendingStates.delete(key);
    }
  }, 60_000).unref();

  return app;
}
