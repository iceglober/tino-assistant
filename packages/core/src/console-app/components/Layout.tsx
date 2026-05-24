import type { JSX } from "react";
import { Outlet } from "react-router-dom";
import type { Session } from "../lib/api.js";
import { useHealth } from "../hooks/useHealth.js";
import { Header } from "./Header.js";
import { HealthFooter } from "./HealthFooter.js";

export function Layout({
  session,
  signOut,
}: {
  session: Session;
  signOut: () => Promise<void>;
}): JSX.Element {
  const { health } = useHealth();

  const status: "ok" | "degraded" | "unreachable" | "checking" = !health
    ? "checking"
    : health.ok
      ? "ok"
      : "degraded";

  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={signOut} />
      <Outlet context={{ session, health }} />
      <HealthFooter health={health} />
    </div>
  );
}
