import type { JSX } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Session } from "../lib/api.js";

const NAV_ITEMS = [
  { path: "/", label: "Home" },
  { path: "/capabilities", label: "Capabilities" },
  { path: "/work", label: "Work" },
  { path: "/workspace", label: "Workspace" },
];

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
  const location = useLocation();

  const statusText =
    status === "ok"
      ? "running"
      : status === "degraded"
        ? "degraded"
        : status === "unreachable"
          ? "unreachable"
          : "checking…";

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname === path;

  return (
    <header className="header">
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="header-brand">
        <img src="/assets/tino-logo.png" alt="tino" className="header-logo" />
        <div>
          <div className="header-wordmark">tino</div>
          <div className="header-sub">personal assistant</div>
        </div>
      </a>
      {session ? (
        <nav className="header-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`header-nav-link${isActive(item.path) ? " active" : ""}`}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="header-right">
        <div className="header-status" aria-live="polite">
          <div className={`status-dot${status === "ok" ? " ok" : ""}`} />
          <span>{statusText}</span>
        </div>
        {session?.user.email ? (
          <div className="header-user">
            <span className="header-user-email">{session.user.email}</span>
            <span className="header-user-sep">·</span>
            <button className="header-nav-btn" type="button" onClick={onSignOut}>
              sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
