import { Database } from "bun:sqlite";
import { type Auth, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { MiddlewareHandler } from "hono";
import type { IdentityStore, UserStore } from "../../identity/store.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { SessionSecondaryStorage } from "../../persistence/factory.js";
import type { UserCapabilityStore } from "../../persistence/user-capabilities.js";
import type { AppLogger } from "../../slack/app.js";

const GOOGLE_CAPABILITY_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
];

/**
 * Build a better-auth instance.
 *
 * ## Session persistence
 *
 * When `sessionStore` is provided (DynamoDB adapter), sessions persist in
 * DynamoDB via better-auth's `secondaryStorage` so multi-user deployments
 * survive ECS restarts. DynamoDB TTL evicts expired sessions automatically.
 *
 * When `sessionStore` is omitted (SQLite / local dev), better-auth uses
 * its built-in database-backed sessions via the SQLite `dbPath`.
 *
 * `BETTER_AUTH_SECRET` MUST be set to a stable value across restarts;
 * without it session token signatures change and all sessions invalidate.
 */
export async function createAuth(opts: {
  config?: ConfigStore;
  googleClientId?: string;
  googleClientSecret?: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
  logger?: AppLogger;
  sessionStore?: SessionSecondaryStorage;
  emailPassword?: boolean;
}): Promise<Auth> {
  let secret = opts.config ? await opts.config.getTyped<string>("auth.secret", "") : "";
  if (!secret) secret = process.env.BETTER_AUTH_SECRET ?? "";
  if (!secret) {
    secret = crypto.randomUUID();
    if (opts.config) {
      await opts.config.set("auth.secret", secret);
      opts.logger?.info("auth secret auto-generated and persisted to config store");
    } else {
      opts.logger?.warn(
        { fix: "set BETTER_AUTH_SECRET env var or provide a config store" },
        "BETTER_AUTH_SECRET not set — sessions will be invalidated on every restart",
      );
    }
  }

  const googleClientId = (opts.config ? await opts.config.getTyped<string>("google.oauth.clientId", "") : "") || opts.googleClientId;
  const googleClientSecret = (opts.config ? await opts.config.getTyped<string>("google.oauth.clientSecret", "") : "") || opts.googleClientSecret;

  // biome-ignore lint/suspicious/noExplicitAny: better-auth social provider types are loose
  const socialProviders: Record<string, any> = {};
  if (googleClientId && googleClientSecret) {
    socialProviders.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      scope: GOOGLE_CAPABILITY_SCOPES,
      accessType: "offline",
      prompt: "consent",
    };
  }

  const authConfig: Parameters<typeof betterAuth>[0] = {
    baseURL: opts.baseUrl,
    secret,
    database: new Database(opts.dbPath ?? "./tino-auth.db"),
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    emailAndPassword: opts.emailPassword ? { enabled: true } : undefined,
    session: { expiresIn: 60 * 60 * 24 },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "member" },
        status: { type: "string", defaultValue: "active" },
        slackUserId: { type: "string", required: false, defaultValue: null },
      },
    },
  };

  if (opts.sessionStore) {
    (authConfig as Record<string, unknown>).secondaryStorage = opts.sessionStore;
  }

  const auth = betterAuth(authConfig) as unknown as Auth;

  // Auto-create tables on first run.
  // `auth.options` is a BetterAuthOptions but the public type is loose; cast
  // through `any` matches the legacy behaviour at the old `console/auth.ts:28`.
  // biome-ignore lint/suspicious/noExplicitAny: better-auth options bag is untyped
  const { runMigrations } = await getMigrations((auth as any).options);
  await runMigrations();

  return auth;
}

/**
 * Hono variables we set on the request context after auth passes.
 *
 * `id` is the tino-UUID (resolved from better-auth's session via the identity
 * store), NOT better-auth's internal user id.
 */
export type AuthVariables = {
  user: {
    id: string;
    email: string;
    name?: string;
    role: "admin" | "member";
    status: "active" | "invited" | "suspended";
    slackUserId?: string | null;
  };
};

/**
 * Build the auth-enforcement middleware for Hono.
 *
 * - Public allowlist (`/api/auth/*`, `/api/health`, `/assets/*`) bypasses the check.
 * - Protected API routes get 401 JSON when no session. Non-API falls through to SPA.
 * - Domain allowlist checked when `allowedDomain` is set.
 * - When `identities` + `users` are provided, resolves session email → tino-UUID
 *   and stashes the full tino user on context. Suspended users get 403.
 * - When stores are absent (local dev), falls back to session-only context.
 *
 * `auth === null` (local dev — no `GOOGLE_OAUTH_CLIENT_ID`) → no-op pass-through.
 */
export function buildAuthMiddleware(opts: {
  authRef: { current: Auth | null };
  allowedDomain?: string;
  logger: AppLogger;
  identities?: IdentityStore;
  users?: UserStore;
  configStore?: ConfigStore;
  userCapabilities?: UserCapabilityStore;
  authDbPath?: string;
  localDev?: boolean;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  const { authRef, logger, identities, users, configStore, userCapabilities, localDev } = opts;

  const synced = new Set<string>();

  async function syncGoogleCredentials(tinoUserId: string, betterAuthUserId: string): Promise<void> {
    if (!userCapabilities || synced.has(tinoUserId)) return;
    synced.add(tinoUserId);

    const existing = await userCapabilities.get(tinoUserId, "gmail");
    if (existing?.credentials?.refreshToken) return;

    try {
      const dbPath = opts.authDbPath ?? process.env.AUTH_DB_PATH ?? "/tmp/tino-auth.db";
      const db = new Database(dbPath, { readonly: true });
      const row = db.query<{ refreshToken: string | null }, [string, string]>(
        "SELECT refreshToken FROM account WHERE userId = ? AND providerId = ? LIMIT 1",
      ).get(betterAuthUserId, "google");
      db.close();

      if (!row?.refreshToken) return;

      let clientId = opts.configStore ? await opts.configStore.getTyped<string>("google.oauth.clientId", "") : "";
      let clientSecret = opts.configStore ? await opts.configStore.getTyped<string>("google.oauth.clientSecret", "") : "";
      if (!clientId) clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
      if (!clientSecret) clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
      if (!clientId || !clientSecret) return;

      const creds = { clientId, clientSecret, refreshToken: row.refreshToken };
      await userCapabilities.set(tinoUserId, "gmail", { enabled: true, credentials: creds, settings: {} });
      await userCapabilities.set(tinoUserId, "calendar", { enabled: true, credentials: creds, settings: { calendarId: "primary" } });
      logger.info({ tinoUserId }, "google capability credentials synced from SSO");
    } catch (err) {
      logger.warn({ tinoUserId, err: (err as Error).message }, "failed to sync google credentials from SSO");
    }
  }

  return async (c, next) => {
    const url = c.req.path;

    if (url.startsWith("/api/auth/") || url === "/api/health" || url.startsWith("/assets/")) {
      await next();
      return;
    }

    const auth = authRef.current;
    if (!auth) {
      await next();
      return;
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      if (url.startsWith("/api/")) {
        return c.json({ error: "unauthorized", message: "sign in required" }, 401);
      }
      await next();
      return;
    }

    let allowedDomain = opts.allowedDomain;
    if (configStore) {
      const stored = await configStore.getTyped<string>("console.allowedDomain", "");
      if (stored) allowedDomain = stored;
    }
    if (allowedDomain && !localDev && !session.user.email?.endsWith(`@${allowedDomain}`)) {
      return c.json({ error: "forbidden", message: `Only @${allowedDomain} accounts allowed` }, 403);
    }

    const email = session.user.email?.toLowerCase();

    if (identities && users && email) {
      let tinoUserId = await identities.resolve("google", email);
      if (!tinoUserId) tinoUserId = await identities.resolve("email", email);

      if (tinoUserId) {
        const tinoUser = await users.get(tinoUserId);
        if (!tinoUser) {
          logger.error({ email, tinoUserId }, "identity link exists but user record missing");
          return c.json({ error: "forbidden", message: "account not provisioned in tino" }, 403);
        }
        if (tinoUser.status === "suspended") {
          return c.json({ error: "forbidden", message: "your access has been revoked" }, 403);
        }
        c.set("user", {
          id: tinoUser.id,
          email: tinoUser.email,
          name: tinoUser.name ?? session.user.name,
          role: tinoUser.role,
          status: tinoUser.status,
          slackUserId: tinoUser.slackUserId,
        });
        await syncGoogleCredentials(tinoUser.id, session.user.id);
        await next();
        return;
      }

      // No tino identity — check auto-provisioning.
      // Localhost auto-provisions all users. Production uses org-domain matching.
      let mode = "allowlist";
      let orgDomain: string | undefined;

      if (configStore) {
        const rawMode = await configStore.get("org.accessControl.mode");
        mode = rawMode ? (JSON.parse(rawMode) as string) : (allowedDomain ? "org-domain" : "allowlist");
        const rawDomain = await configStore.get("org.accessControl.orgDomain");
        orgDomain = rawDomain ? (JSON.parse(rawDomain) as string) : allowedDomain;
      } else if (allowedDomain) {
        mode = "org-domain";
        orgDomain = allowedDomain;
      }

      const shouldAutoProvision =
        localDev ||
        (mode === "org-domain" && orgDomain && email.endsWith(`@${orgDomain}`));

      if (shouldAutoProvision) {
        const existingUsers = await users.list();
        const hasAdmin = existingUsers.some((u) => u.role === "admin");
        const role = hasAdmin ? "member" : "admin";
        const provider = localDev ? "email" : "google";

        const newUser = await users.create({
          id: crypto.randomUUID(),
          email,
          name: session.user.name ?? undefined,
          role,
          status: "active",
          slackUserId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await identities.link({
          provider,
          externalId: email,
          tinoUserId: newUser.id,
          linkedAt: Date.now(),
        });
        logger.info({ tinoUserId: newUser.id, email, role, provider }, "auto-provisioned user (console)");
        c.set("user", {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          status: newUser.status,
          slackUserId: newUser.slackUserId,
        });
        await syncGoogleCredentials(newUser.id, session.user.id);
        await next();
        return;
      }

      return c.json({ error: "forbidden", message: "account not provisioned in tino — ask your admin" }, 403);
    }

    // Fallback: no identity/user stores (local dev or stores not wired)
    c.set("user", {
      id: session.user.id,
      email: session.user.email ?? "",
      name: session.user.name,
      role: "admin",
      status: "active",
      slackUserId: null,
    });
    await next();
  };
}
