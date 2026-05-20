import { Database } from "bun:sqlite";
import { type Auth, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { MiddlewareHandler } from "hono";
import type { IdentityStore, UserStore } from "../../identity/store.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { SessionSecondaryStorage } from "../../persistence/factory.js";
import type { AppLogger } from "../../slack/app.js";

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
  googleClientId: string;
  googleClientSecret: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
  logger?: AppLogger;
  sessionStore?: SessionSecondaryStorage;
}): Promise<Auth> {
  const envSecret = process.env.BETTER_AUTH_SECRET;
  if (!envSecret) {
    // Without a stable secret, every process restart silently invalidates
    // ALL outstanding sessions. Use a per-process random fallback so dev
    // works, but warn loudly so production deployments fix it.
    opts.logger?.warn(
      { fix: "set BETTER_AUTH_SECRET env var (Pulumi: SecretsManager)" },
      "BETTER_AUTH_SECRET not set — sessions will be invalidated on every restart",
    );
  }
  const secret = envSecret ?? crypto.randomUUID();

  const authConfig: Parameters<typeof betterAuth>[0] = {
    baseURL: opts.baseUrl,
    secret,
    database: new Database(opts.dbPath ?? "./tino-auth.db"),
    socialProviders: {
      google: {
        clientId: opts.googleClientId,
        clientSecret: opts.googleClientSecret,
      },
    },
    session: { expiresIn: 60 * 60 * 24 },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "member" },
        status: { type: "string", defaultValue: "active" },
        slackUserId: { type: "string", required: false },
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
  auth: Auth | null;
  allowedDomain: string | undefined;
  logger: AppLogger;
  identities?: IdentityStore;
  users?: UserStore;
  configStore?: ConfigStore;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  const { auth, allowedDomain, logger, identities, users, configStore } = opts;

  return async (c, next) => {
    const url = c.req.path;

    if (url.startsWith("/api/auth/") || url === "/api/health" || url.startsWith("/assets/")) {
      await next();
      return;
    }

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

    if (allowedDomain && !session.user.email?.endsWith(`@${allowedDomain}`)) {
      return c.json({ error: "forbidden", message: `Only @${allowedDomain} accounts allowed` }, 403);
    }

    const email = session.user.email?.toLowerCase();

    if (identities && users && email) {
      const tinoUserId = await identities.resolve("google", email);

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
        await next();
        return;
      }

      // No tino identity for this email — check org-domain auto-provisioning
      if (configStore) {
        const rawMode = await configStore.get("org.accessControl.mode");
        const mode = rawMode ? (JSON.parse(rawMode) as string) : "allowlist";

        if (mode === "org-domain") {
          const rawDomain = await configStore.get("org.accessControl.orgDomain");
          const orgDomain = rawDomain ? (JSON.parse(rawDomain) as string) : undefined;

          if (orgDomain && email.endsWith(`@${orgDomain}`)) {
            const newUser = await users.create({
              id: crypto.randomUUID(),
              email,
              name: session.user.name ?? undefined,
              role: "member",
              status: "active",
              slackUserId: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            await identities.link({
              provider: "google",
              externalId: email,
              tinoUserId: newUser.id,
              linkedAt: Date.now(),
            });
            logger.info({ tinoUserId: newUser.id, email }, "auto-provisioned user via org-domain (console)");
            c.set("user", {
              id: newUser.id,
              email: newUser.email,
              name: newUser.name,
              role: newUser.role,
              status: newUser.status,
              slackUserId: newUser.slackUserId,
            });
            await next();
            return;
          }
        }
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
