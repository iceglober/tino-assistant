import type { JSX, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Session } from "../lib/api.js";

export function RequireRole({
  session,
  requiredRole,
  children,
}: {
  session: Session | null;
  requiredRole: "admin" | "member";
  children: ReactNode;
}): JSX.Element {
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
