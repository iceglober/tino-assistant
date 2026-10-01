import { type Auth, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { MiddlewareHandler } from "hono";
import type { IdentityStore, UserStore } from "@tino/core/ports/outbound";
import type { ConfigStore } from "@tino/core/ports/outbound";
import type { UserCapabilityStore } from "@tino/core/ports/outbound";
import type { Logger } from "@tino/core/ports/outbound";

const GOOGLE_CAPABILITY_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/**
 * Build a better-auth instance.
 *
 * `database` is an opaque handle from the persistence layer: a pg Pool
 * (postgres — better-auth wraps it in its kysely PostgresDialect) or a
 * bun:sqlite Database (local dev). Sessions are database-backed and durable
 * either way. The auth secret persists in the config store, so sessions
 * survive restarts without a BETTER_AUTH_SECRET env var.
 */
export async function createAuth(opts: {
  config?: ConfigStore;
  googleClientId?: string;
  googleClientSecret?: string;
  allowedDomain?: string;
  baseUrl: string;
  /** pg Pool or bun:sqlite Database — Persistence.authDatabase. */
  database: unknown;
  logger?: Logger;
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
    database: opts.database as Parameters<typeof betterAuth>[0]["database"],
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
  logger: Logger;
  identities?: IdentityStore;
  users?: UserStore;
  configStore?: ConfigStore;
  userCapabilities?: UserCapabilityStore;
  /** Reads better-auth's stored Google refresh token — Persistence.getGoogleRefreshToken. */
  getGoogleRefreshToken?: (betterAuthUserId: string) => Promise<string | null>;
  localDev?: boolean;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  const { authRef, logger, identities, users, configStore, userCapabilities, getGoogleRefreshToken, localDev } = opts;

  const synced = new Set<string>();

  async function syncGoogleCredentials(tinoUserId: string, betterAuthUserId: string): Promise<void> {
    if (!userCapabilities || !getGoogleRefreshToken || synced.has(tinoUserId)) return;
    synced.add(tinoUserId);

    const existing = await userCapabilities.get(tinoUserId, "gmail");
    if (existing?.credentials?.refreshToken) return;

    try {
      const refreshToken = await getGoogleRefreshToken(betterAuthUserId);
      if (!refreshToken) return;

      let clientId = opts.configStore ? await opts.configStore.getTyped<string>("google.oauth.clientId", "") : "";
      let clientSecret = opts.configStore ? await opts.configStore.getTyped<string>("google.oauth.clientSecret", "") : "";
      if (!clientId) clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
      if (!clientSecret) clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
      if (!clientId || !clientSecret) return;

      const creds = { clientId, clientSecret, refreshToken };
      await userCapabilities.set(tinoUserId, "gmail", { enabled: true, credentials: creds, settings: {} });
      await userCapabilities.set(tinoUserId, "calendar", { enabled: true, credentials: creds, settings: { calendarId: "primary" } });
      logger.info({ tinoUserId }, "google capability credentials synced from SSO");
    } catch (err) {
      logger.warn({ tinoUserId, err: (err as Error).message }, "failed to sync google credentials from SSO");
    }
  }

  return async (c, next) => {
    const url = c.req.path;

    // Slack OAuth is authorized by its own signed connect token, not a console
    // session — a workspace member connects without logging into the console.
    if (
      url.startsWith("/api/auth/") ||
      url === "/api/health" ||
      url.startsWith("/assets/") ||
      url.startsWith("/api/oauth/slack/")
    ) {
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
        // An admin invited this address; signing in is what accepts the invite.
        const current =
          tinoUser.status === "invited"
            ? await users.update(tinoUser.id, { status: "active", name: tinoUser.name ?? session.user.name ?? undefined })
            : tinoUser;
        if (tinoUser.status === "invited") logger.info({ tinoUserId: tinoUser.id }, "invited user activated on console sign-in");
        c.set("user", {
          id: current.id,
          email: current.email,
          name: current.name ?? session.user.name,
          role: current.role,
          status: current.status,
          slackUserId: current.slackUserId,
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

      // A fresh install with no domain configured has no other way in: the
      // first person to sign in becomes the admin. With a domain configured,
      // the org-domain rule below decides (and the first match is the admin).
      const existingUsers = await users.list();
      const shouldAutoProvision =
        localDev ||
        (existingUsers.length === 0 && !orgDomain) ||
        (mode === "org-domain" && orgDomain && email.endsWith(`@${orgDomain}`));

      if (shouldAutoProvision) {
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

/**
 * Gate a route group to admins. Members get 403; no session gets 401. Used for
 * everything that exposes or changes deployment-wide settings and secrets.
 */
export const requireAdmin: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return c.json({ error: "forbidden", message: "admins only" }, 403);
  await next();
};
