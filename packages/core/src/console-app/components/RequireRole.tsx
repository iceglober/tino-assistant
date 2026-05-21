import type { JSX, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Session } from "../lib/api.js";

export function RequireRole({
  session,
  loading,
  requiredRole,
  children,
}: {
  session: Session | null;
  loading?: boolean;
  requiredRole: "admin" | "member";
  children: ReactNode;
}): JSX.Element {
  if (loading) {
    return <div className="page" style={{ textAlign: "center", paddingTop: 80 }}>loading…</div>;
  }
  if (!session?.user) {
    return <Navigate to="/login" replace />;
  }
  if (requiredRole === "admin" && session.user.role !== "admin") {
    return (
      <div className="page" style={{ textAlign: "center", paddingTop: 80 }}>
        <h2 style={{ color: "var(--err)" }}>access denied</h2>
        <p style={{ color: "var(--text-dim)" }}>this page requires admin access.</p>
      </div>
    );
  }
  return <>{children}</>;
}
