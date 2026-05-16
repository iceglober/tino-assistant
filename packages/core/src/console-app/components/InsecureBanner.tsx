import type { JSX } from 'react';

/**
 * InsecureBanner — top-of-page warning shown when the console is served
 * over plain HTTP. Encourages the operator to deploy with `consoleDomain`
 * (HTTPS via ACM/Route53) so OAuth tokens, Slack tokens, and session
 * cookies aren't transmitted in plaintext.
 *
 * Mirror: visual style of `.success-banner` in `tokens.css:120-144` but
 * tinted with `--err` (the same approach as the existing `.field-error`
 * and `.btn-danger` rules). Stays inline so we don't need a new CSS rule
 * file — design tokens only, never raw hex.
 *
 * Hidden when:
 *   - protocol is `https:` (production with consoleDomain)
 *   - protocol is `file:` (vite dev preview from disk — irrelevant)
 *   - host is `localhost` or `127.0.0.1` (local dev — operator already
 *     knows it's HTTP and the cookie is same-origin)
 */
export function InsecureBanner(): JSX.Element | null {
  if (typeof window === 'undefined') return null;
  const { protocol, hostname } = window.location;
  if (protocol !== 'http:') return null;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        background: 'rgba(192, 96, 96, 0.08)',
        borderBottom: '1px solid rgba(192, 96, 96, 0.35)',
        color: 'var(--err)',
        padding: '10px 16px',
        fontSize: '0.857rem',
        textAlign: 'center',
      }}
    >
      <strong>Running without HTTPS.</strong>{' '}
      <span style={{ color: 'var(--text-sec)' }}>
        OAuth tokens and session cookies travel in plaintext on this
        connection. Add{' '}
        <code
          style={{
            fontFamily: 'var(--mono)',
            background: 'var(--bg-inset)',
            padding: '1px 5px',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          consoleDomain
        </code>{' '}
        to your Pulumi stack to enable HTTPS.
      </span>
    </div>
  );
}
