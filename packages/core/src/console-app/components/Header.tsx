import type { JSX } from 'react';
import type { Session } from '../lib/api.js';

/**
 * Console header — logo, wordmark, status dot, signed-in user.
 *
 * Mirror: `html.ts:1208-1224`.
 */
export function Header({
  status,
  session,
  onSignOut,
}: {
  status: 'ok' | 'degraded' | 'unreachable' | 'checking';
  session: Session | null;
  onSignOut: () => void;
}): JSX.Element {
  const statusText =
    status === 'ok' ? 'running'
    : status === 'degraded' ? 'degraded'
    : status === 'unreachable' ? 'unreachable'
    : 'checking…';

  return (
    <header className="header">
      <img src="/assets/tino-logo.png" alt="tino" className="header-logo" />
      <div>
        <div className="header-wordmark">tino</div>
        <div className="header-sub">personal assistant</div>
      </div>
      <div className="header-status" aria-live="polite">
        <div className={`status-dot${status === 'ok' ? ' ok' : ''}`} />
        <span>{statusText}</span>
      </div>
      {session?.user.email ? (
        <div className="header-user">
          <span className="header-user-email">{session.user.email}</span>
          <span className="header-user-sep">·</span>
          <button className="header-signout" type="button" onClick={onSignOut}>
            sign out
          </button>
        </div>
      ) : null}
    </header>
  );
}
