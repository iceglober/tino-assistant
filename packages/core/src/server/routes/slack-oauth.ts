import { Hono } from "hono";
import type { ConfigStore } from "../../persistence/config.js";
import type { UserCapabilityStore } from "../../persistence/user-capabilities.js";
import type { IdentityStore, UserStore } from "../../identity/store.js";
import type { AuditLogger } from "../../audit/logger.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

const SLACK_USER_SCOPES = [
  "search:read",
  "im:read",
  "im:history",
  "mpim:read",
  "mpim:history",
].join(",");

export function createSlackOAuthRoutes(opts: {
  config: ConfigStore;
  userCapabilities?: UserCapabilityStore;
  identities?: IdentityStore;
  users?: UserStore;
  logger: AppLogger;
  auditLogger?: AuditLogger;
  baseUrl: string;
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { config, userCapabilities, identities, users, logger, auditLogger, baseUrl } = opts;

  const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

  async function getClientCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
    let clientId = await config.getTyped<string>("slack.clientId", "");
    let clientSecret = await config.getTyped<string>("slack.clientSecret", "");
    if (!clientId) clientId = process.env.SLACK_CLIENT_ID ?? "";
    if (!clientSecret) clientSecret = process.env.SLACK_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  app.get("/authorize", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const creds = await getClientCredentials();
    if (!creds) {
      return c.json({ error: "Slack OAuth not configured — add Client ID and Secret in setup" }, 500);
    }

    const state = crypto.randomUUID();
    pendingStates.set(state, { userId: user.id, expiresAt: Date.now() + 10 * 60 * 1000 });

    const redirectUri = `${baseUrl}/api/oauth/slack/callback`;
    const params = new URLSearchParams({
      client_id: creds.clientId,
      user_scope: SLACK_USER_SCOPES,
      redirect_uri: redirectUri,
      state,
    });

    const url = `https://slack.com/oauth/v2/authorize?${params}`;
    logger.info({ redirectUri }, "Slack OAuth authorize redirect");
    return c.redirect(url);
  });

  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      logger.warn({ error }, "Slack OAuth consent denied");
      return c.redirect("/?slack_oauth=denied");
    }

    if (!code || !state) {
      return c.redirect("/?slack_oauth=error");
    }

    const pending = pendingStates.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingStates.delete(state ?? "");
      return c.redirect("/?slack_oauth=expired");
    }
    pendingStates.delete(state);

    const user = c.get("user");
    if (!user || user.id !== pending.userId) {
      return c.redirect("/?slack_oauth=mismatch");
    }

    const creds = await getClientCredentials();
    if (!creds) {
      return c.redirect("/?slack_oauth=error");
    }

    try {
      const redirectUri = `${baseUrl}/api/oauth/slack/callback`;
      const resp = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const data = (await resp.json()) as {
        ok: boolean;
        error?: string;
        authed_user?: { id: string; access_token: string };
      };

      if (!data.ok || !data.authed_user?.access_token) {
        logger.warn({ userId: user.id, error: data.error }, "Slack OAuth token exchange failed");
        return c.redirect("/?slack_oauth=error");
      }

      const userToken = data.authed_user.access_token;
      const slackUserId = data.authed_user.id;

      if (userCapabilities) {
        await userCapabilities.set(user.id, "slack-personal", {
          enabled: true,
          credentials: { userToken },
          settings: {},
        });
      } else {
        await config.set(`user.${user.id}.capability.slack-personal`, {
          enabled: true,
          credentials: { userToken },
          settings: {},
        });
      }

      if (identities) {
        try {
          await identities.link({
            provider: "slack",
            externalId: slackUserId,
            tinoUserId: user.id,
            linkedAt: Date.now(),
          });
        } catch {
          logger.debug({ userId: user.id, slackUserId }, "slack identity link already exists");
        }
      }

      if (users) {
        try {
          await users.update(user.id, { slackUserId });
        } catch {
          logger.debug({ userId: user.id, slackUserId }, "failed to update user slackUserId");
        }
      }

      if (auditLogger) {
        await auditLogger.log({
          userId: user.id,
          action: "config_change",
          toolName: "slack-personal",
          status: "success",
        });
      }

      logger.info({ userId: user.id, slackUserId }, "Slack OAuth connected — personal capability + identity stored");
      return c.redirect("/?slack_oauth=success");
    } catch (err) {
      logger.error({ userId: user.id, err: (err as Error).message }, "Slack OAuth token exchange failed");
      return c.redirect("/?slack_oauth=error");
    }
  });

  app.get("/status", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const creds = await getClientCredentials();
    const configured = !!creds;

    let connected = false;
    if (userCapabilities) {
      const cap = await userCapabilities.get(user.id, "slack-personal");
      connected = !!cap?.credentials?.userToken;
    }

    return c.json({ configured, connected });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pendingStates) {
      if (val.expiresAt < now) pendingStates.delete(key);
    }
  }, 60_000).unref();

  return app;
}
