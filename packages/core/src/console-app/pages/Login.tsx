import { useState, type JSX } from 'react';

/**
 * Sign-in page. Mirrors the inline login HTML at `console/server.ts:396-449`
 * plus the `signOut` flow at `html.ts:2061-2066`.
 *
 * We POST to /api/auth/sign-in/social with `{ provider: 'google', callbackURL: '/' }`.
 * better-auth returns a JSON `{ url }` to redirect the browser to Google, or it
 * issues an opaque redirect — handle both.
 */
export function Login(): JSX.Element {
  const [error, setError] = useState<string>('');

  const signIn = async (): Promise<void> => {
    setError('');
    try {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
        redirect: 'manual',
      });
      if (res.status === 200) {
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      } else if (res.type === 'opaqueredirect' || res.status === 302) {
        const location = res.headers.get('location');
        if (location) {
          window.location.href = location;
          return;
        }
      }
      setError('sign in failed — check console');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/assets/tino-logo.png" alt="tino" className="login-logo" />
        <h1 className="login-heading">tino</h1>
        <p className="login-sub">sign in with your Google account to continue</p>
        <button className="login-btn" type="button" onClick={() => void signIn()}>
          sign in with Google
        </button>
        {error ? <p className="login-error">{error}</p> : <p className="login-error" />}
      </div>
    </div>
  );
}
