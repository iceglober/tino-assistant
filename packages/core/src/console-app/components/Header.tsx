import { type JSX, useState } from "react";
import type { Session } from "../lib/api.js";
import { restartTino } from "../lib/api.js";

/**
 * Console header — logo, wordmark, status dot, signed-in user, sign out, restart.
 *
 * Mirror: `html.ts:1208-1224` (legacy header).
 *
 * Wave 3.4 — adds a "restart" button next to "sign out". Clicking it:
 *   1. POSTs /api/admin/restart (server returns 202 with { ok: true } and
 *      schedules `shutdown` on the next tick — process exits ~100ms later).
 *   2. Renders a full-screen overlay with a 30-second auto-refresh timer.
 *   3. Calls `window.location.reload()` after 30s — by then ECS has rolled
 *      the task and the new container is reachable.
 *
 * The overlay is intentionally non-dismissible. If the restart fails the
 * audit-log entry is the receipt; the operator can re-trigger from the new
 * console after the page reloads.
 */
export function Header({
  status,
  session,
  onSignOut,
}: {
  status: "ok" | "degraded" | "unreachable" | "checking";
  session: Session | null;
  onSignOut: () => void;
}): JSX.Element {
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const statusText =
    status === "ok"
      ? "running"
      : status === "degraded"
        ? "degraded"
        : status === "unreachable"
          ? "unreachable"
          : "checking…";

  const onRestart = async (): Promise<void> => {
    if (restarting) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Restart tino? The console will be unreachable for ~30 seconds while ECS rolls the task.",
      );
      if (!ok) return;
    }
    setRestarting(true);
    setRestartError(null);
    const result = await restartTino();
    if (!result.ok) {
      setRestartError(result.error ?? "restart request failed");
      setRestarting(false);
      return;
    }
    // Wait 30 seconds for ECS to roll the task, then refresh.
    if (typeof window !== "undefined") {
      window.setTimeout(() => window.location.reload(), 30000);
    }
  };

  return (
    <>
      <header className="header">
        <img src="/assets/tino-logo.png" alt="tino" className="header-logo" />
        <div>
          <div className="header-wordmark">tino</div>
          <div className="header-sub">personal assistant</div>
        </div>
        <div className="header-status" aria-live="polite">
          <div className={`status-dot${status === "ok" ? " ok" : ""}`} />
          <span>{statusText}</span>
        </div>
        {session?.user.email ? (
          <div className="header-user">
            <span className="header-user-email">{session.user.email}</span>
            <span className="header-user-sep">·</span>
            <button
              className="header-signout"
              type="button"
              onClick={() => void onRestart()}
              disabled={restarting}
              aria-label="Restart tino"
            >
              restart
            </button>
            <span className="header-user-sep">·</span>
            <button className="header-signout" type="button" onClick={onSignOut}>
              sign out
            </button>
          </div>
        ) : null}
        {restartError ? (
          <div role="alert" style={{ color: "var(--err)", marginLeft: 12 }}>
            {restartError}
          </div>
        ) : null}
      </header>
      {restarting ? <RestartOverlay /> : null}
    </>
  );
}

/**
 * Full-screen overlay shown while the ECS task rolls. Reuses the global
 * design tokens — no new colors. The page auto-reloads after 30 seconds
 * (timer set in `Header.onRestart`).
 */
function RestartOverlay(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label="Restarting tino"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg-deep)",
        opacity: 0.95,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        gap: 16,
        color: "var(--accent)",
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "0.05em" }}>restarting tino…</div>
      <div style={{ fontSize: 14, opacity: 0.8 }}>ECS is rolling the task. This page will refresh in ~30 seconds.</div>
    </div>
  );
}
