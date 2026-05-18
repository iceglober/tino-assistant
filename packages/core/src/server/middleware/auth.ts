import { Database } from "bun:sqlite";
import { type Auth, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { MiddlewareHandler } from "hono";
import type { AppLogger } from "../../slack/app.js";

/**
 * Build a better-auth instance.
 *
 * Mirror of the previous `console/auth.ts` `createAuth` factory — same
 * `betterAuth({ ... })` config block, same migration step. Only the surrounding
 * adapter changes: instead of `toNodeHandler` for raw `node:http`, this module
 * exposes a Hono middleware (`authMiddleware`) and a Hono-shaped auth handler.
 *
 * ## Session persistence (gap #7) — MVP behaviour
 *
 * Sessions are stored in SQLite at `dbPath` (defaults to `/tmp/tino-auth.db`
 * in production). On ECS, `/tmp` is wiped between task restarts — sessions
 * are lost and users must re-login. This is acceptable for MVP because the
 * console is a single-user (`ALLOWED_SLACK_USER_ID`) tool and ECS restarts
 * are rare; the re-login flow is one Google-OAuth click (~3-5 seconds).
 *
 * For sessions to survive restarts, `BETTER_AUTH_SECRET` MUST be set to a
 * stable value across restarts. Without it, even a hypothetical durable
 * session store would be invalidated because better-auth's session token
 * signature depends on the secret. In production the secret is provisioned
 * via Pulumi Secrets Manager — see `packages/aws/src/pulumi/secrets.ts`.
 *
 * Future: replace SQLite with a DynamoDB-backed `secondaryStorage` adapter
 * to eliminate the re-login-on-restart trade-off entirely (gap #7 follow-up).
 */
export async function createAuth(opts: {
  googleClientId: string;
  googleClientSecret: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
  logger?: AppLogger;
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

  const auth = betterAuth({
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
        slackUserId: { type: "string" },
      },
    },
  }) as unknown as Auth;

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
 */
export type AuthVariables = {
  user: {
    id: string;
    email: string;
    name?: string;
  };
};

/**
 * Build the auth-enforcement middleware for Hono.
 *
 * - Public allowlist (`/api/auth/*`, `/api/health`, `/assets/*`) bypasses the check.
 *   The Hono auth handler at `/api/auth/*` is mounted separately in `server/index.ts`;
 *   this middleware just lets those requests through.
 * - For protected routes: API requests (`/api/*`) get a 401 JSON response when no
 *   session is present. Non-API requests fall through (Hono's static handler then
 *   serves the SPA's `index.html` and the React `<Login>` page handles sign-in).
 * - When `allowedDomain` is set, sessions whose email isn't `@<domain>` get 403.
 *
 * When `auth` is `null` (local dev — no `GOOGLE_OAUTH_CLIENT_ID`), the middleware
 * is a no-op pass-through.
 */
export function buildAuthMiddleware(opts: {
  auth: Auth | null;
  allowedDomain: string | undefined;
  logger: AppLogger;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  const { auth, allowedDomain } = opts;

  return async (c, next) => {
    const url = c.req.path;

    // Public paths that bypass auth (auth routes themselves, health for ALB, static assets)
    if (url.startsWith("/api/auth/") || url === "/api/health" || url.startsWith("/assets/")) {
      await next();
      return;
    }

    // Auth disabled (local dev) — pass through
    if (!auth) {
      await next();
      return;
    }

    // Check session
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      if (url.startsWith("/api/")) {
        return c.json({ error: "unauthorized", message: "sign in required" }, 401);
      }
      // Non-API: fall through. Hono's SPA fallback serves index.html and the
      // React app shows the <Login> page when /api/auth/get-session returns null.
      await next();
      return;
    }

    // Domain allowlist
    if (allowedDomain && !session.user.email?.endsWith(`@${allowedDomain}`)) {
      return c.json({ error: "forbidden", message: `Only @${allowedDomain} accounts allowed` }, 403);
    }

    // Stash user on context for downstream handlers
    c.set("user", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
    await next();
  };
}
