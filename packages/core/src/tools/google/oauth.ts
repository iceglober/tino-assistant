import { google } from 'googleapis';
import type { Env } from '../../env.js';

/**
 * Create a configured OAuth2 client with the refresh token set.
 *
 * Shared by Calendar (Phase 6) and Gmail (Phase 7). The client auto-refreshes
 * access tokens using the refresh token — no manual token management needed.
 *
 * Throws if any of the three required env vars are missing. Caller
 * (buildTools) catches and degrades gracefully.
 */
export function createGoogleAuth(env: Env): InstanceType<typeof google.auth.OAuth2> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is not set');
  }
  if (!env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is not set');
  }
  if (!env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error('GOOGLE_OAUTH_REFRESH_TOKEN is not set — run: pnpm tsx scripts/google-auth.ts');
  }

  const auth = new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
  );

  auth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });

  return auth;
}
