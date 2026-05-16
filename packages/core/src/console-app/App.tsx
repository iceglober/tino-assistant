import { useEffect, useState, type JSX } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Login } from './pages/Login.js';
import { Setup } from './pages/Setup.js';
import { Console, fetchInitialConsoleValues } from './pages/Console.js';
import { ToastProvider } from './hooks/useToast.js';
import { InsecureBanner } from './components/InsecureBanner.js';
import { getConfig, getSession, type Session, UnauthorizedError } from './lib/api.js';

type AppState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'setup'; step: 1 | 2 }
  | { kind: 'console'; values: Awaited<ReturnType<typeof fetchInitialConsoleValues>> };

/**
 * Top-level routing logic.
 *
 * Mirror: the inline `init()` at `html.ts:2075-2103` + the auth check at
 * `console/server.ts:382-451`.
 *
 * Decision tree:
 *   1. Try GET /api/config.
 *      - 401 → no session → render <Login>.
 *      - 200 → check what's configured.
 *   2. If slack.botToken + slack.appToken aren't set → step 1 of <Setup>.
 *   3. If bedrock.modelId + slack.adminUserId aren't set → step 2 of <Setup>.
 *   4. Otherwise → <Console> with current values pre-filled.
 *
 * The session check is best-effort — if it fails, we still try the config
 * fetch and let the 401 path handle redirection. This matches the legacy
 * behaviour where the inline JS just reloaded on 401.
 */
function AppRouter(): JSX.Element {
  const [state, setState] = useState<AppState>({ kind: 'loading' });

  useEffect(() => {
    void (async () => {
      try {
        // Probe config — also serves as the auth check. If we're unauthorized,
        // getConfig throws UnauthorizedError.
        const entries = await getConfig();
        const cfg = Object.fromEntries(
          entries.map((e) => {
            let val: unknown = e.value;
            try {
              val = JSON.parse(e.value);
            } catch {
              /* leave raw */
            }
            return [e.key, val];
          }),
        ) as Record<string, unknown>;

        const hasSlack = !!(cfg['slack.botToken'] && cfg['slack.appToken']);
        const hasBasics = !!(cfg['bedrock.modelId'] && cfg['slack.adminUserId']);

        if (!hasSlack) {
          setState({ kind: 'setup', step: 1 });
          return;
        }
        if (!hasBasics) {
          setState({ kind: 'setup', step: 2 });
          return;
        }

        const values = await fetchInitialConsoleValues();
        setState({ kind: 'console', values });
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          setState({ kind: 'login' });
        } else {
          // Couldn't reach the API — best fallback is the welcome screen so
          // the user at least sees something useful (matches legacy behaviour).
          setState({ kind: 'setup', step: 1 });
        }
      }
    })();
  }, []);

  if (state.kind === 'loading') {
    return <div className="page" style={{ color: 'var(--text-dim)' }}>loading…</div>;
  }
  if (state.kind === 'login') return <Login />;
  if (state.kind === 'setup') return <Setup initialStep={state.step} />;
  return (
    <Console
      initialSlackBot={state.values.slackBot}
      initialSlackApp={state.values.slackApp}
      initialModelId={state.values.modelId}
      initialAdminId={state.values.adminId}
    />
  );
}

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <InsecureBanner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<AppRouter />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

// Helper used only to keep the linter happy in this top-level file —
// React's strict mode unused import warnings are silenced by referencing
// the type from the module.
export type { Session };
