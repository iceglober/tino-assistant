/**
 * better-auth's React client, pointed at the server's /api/auth.
 *
 * Created lazily: the root route is pre-rendered at build time (SPA mode), and
 * there is no `window` there.
 */
import { createAuthClient } from "better-auth/react";
import { invalidateMe } from "./session";

let client: ReturnType<typeof createAuthClient> | null = null;

export function authClient(): ReturnType<typeof createAuthClient> {
  if (!client) {
    client = createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });
  }
  return client;
}

/** better-auth returns `{ data, error }`; this turns `error` into a sentence. */
export function authErrorMessage(
  error: { message?: string; code?: string; status?: number } | null | undefined,
): string {
  if (!error) return "something went wrong — try again.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "that email and password don't match.";
    case "EMAIL_NOT_VERIFIED":
      return "confirm your email first — we sent you a link.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "there's already an account with that email. sign in instead?";
    case "PASSWORD_TOO_SHORT":
      return "that password is too short — use at least 10 characters.";
    case "INVALID_TOKEN":
      return "this link has expired or was already used. ask for a new one.";
    default:
      break;
  }
  if (error.status === 429) return "too many attempts — wait a minute and try again.";
  return error.message ? lowerFirst(error.message) : "something went wrong — try again.";
}

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0]?.toLowerCase() + s.slice(1) : s);

export async function signOut(): Promise<void> {
  try {
    await authClient().signOut();
  } finally {
    invalidateMe();
  }
}
