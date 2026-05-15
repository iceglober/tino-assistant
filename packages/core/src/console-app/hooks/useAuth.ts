import { useEffect, useState } from 'react';
import { getSession, signOut as apiSignOut, type Session } from '../lib/api.js';

export interface UseAuthResult {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * Reads the current better-auth session and exposes a sign-out helper.
 * Mirror of `html.ts:2046-2066`.
 *
 * When no session is present, `session` is `null`. The auth middleware on
 * the server lets non-API routes pass through unauthenticated, so the
 * SPA's `<Login>` route renders the sign-in card.
 */
export function useAuth(): UseAuthResult {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSession();
      if (alive) {
        setSession(s);
        setLoading(false);
      }
    })();
    return (): void => {
      alive = false;
    };
  }, []);

  const signOut = async (): Promise<void> => {
    await apiSignOut();
    window.location.href = '/';
  };

  return { session, loading, signOut };
}
