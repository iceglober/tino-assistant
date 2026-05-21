import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "../lib/api.js";

export function Header({
  status,
  session,
  onSignOut,
}: {
  status: "ok" | "degraded" | "unreachable" | "checking";
  session: Session | null;
  onSignOut: () => void;
}): JSX.Element {
  const navigate = useNavigate();

  const statusText =
    status === "ok"
      ? "running"
      : status === "degraded"
        ? "degraded"
        : status === "unreachable"
          ? "unreachable"
          : "checking…";

  return (
    <header className="header">
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}>
        <img src="/assets/tino-logo.png" alt="tino" className="header-logo" />
        <div>
          <div className="header-wordmark">tino</div>
          <div className="header-sub">personal assistant</div>
        </div>
      </a>
      <div className="header-status" aria-live="polite">
        <div className={`status-dot${status === "ok" ? " ok" : ""}`} />
        <span>{statusText}</span>
      </div>
      {session?.user.email ? (
        <nav className="header-user" aria-label="Console navigation">
          <span className="header-user-email">{session.user.email}</span>
          <span className="header-user-sep">·</span>
          <button className="header-nav-btn" type="button" onClick={onSignOut}>
            sign out
          </button>
        </nav>
      ) : null}
    </header>
  );
}
