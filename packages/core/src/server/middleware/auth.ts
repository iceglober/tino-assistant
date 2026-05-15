import { betterAuth, type Auth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import Database from 'better-sqlite3';
import type { MiddlewareHandler } from 'hono';
import type { AppLogger } from '../../slack/app.js';

/**
 * Build a better-auth instance.
 *
 * Mirror of the previous `console/auth.ts` `createAuth` factory — same
 * `betterAuth({ ... })` config block, same migration step. Only the surrounding
 * adapter changes: instead of `toNodeHandler` for raw `node:http`, this module
 * exposes a Hono middleware (`authMiddleware`) and a Hono-shaped auth handler.
 */
export async function createAuth(opts: {
  googleClientId: string;
  googleClientSecret: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
}): Promise<Auth> {
  const auth = betterAuth({
    baseURL: opts.baseUrl,
    secret: process.env['BETTER_AUTH_SECRET'] ?? crypto.randomUUID(),
    database: new Database(opts.dbPath ?? './tino-auth.db'),
    socialProviders: {
      google: {
        clientId: opts.googleClientId,
        clientSecret: opts.googleClientSecret,
      },
    },
    session: { expiresIn: 60 * 60 * 24 },
  }) as unknown as Auth;

  // Auto-create tables on first run.
  // `auth.options` is a BetterAuthOptions but the public type is loose; cast
  // through `any` matches the legacy behaviour at the old `console/auth.ts:28`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    if (
      url.startsWith('/api/auth/') ||
      url === '/api/health' ||
      url.startsWith('/assets/')
    ) {
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
      if (url.startsWith('/api/')) {
        return c.json({ error: 'unauthorized', message: 'sign in required' }, 401);
      }
      // Non-API: fall through. Hono's SPA fallback serves index.html and the
      // React app shows the <Login> page when /api/auth/get-session returns null.
      await next();
      return;
    }

    // Domain allowlist
    if (allowedDomain && !session.user.email?.endsWith(`@${allowedDomain}`)) {
      return c.json(
        { error: 'forbidden', message: `Only @${allowedDomain} accounts allowed` },
        403,
      );
    }

    // Stash user on context for downstream handlers
    c.set('user', {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
    await next();
  };
}
