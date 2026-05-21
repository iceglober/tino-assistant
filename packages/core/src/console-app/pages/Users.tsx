import { type JSX, useEffect, useState } from "react";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { RequireRole } from "../components/RequireRole.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import { getOrgUsers, type OrgUser, patchOrgUser } from "../lib/api.js";

export function Users(): JSX.Element {
  const { session, loading, signOut } = useAuth();
  const { health } = useHealth();
  const toast = useToast();
  const status: "ok" | "degraded" | "unreachable" | "checking" = !health ? "checking" : health.ok ? "ok" : "degraded";

  return (
    <RequireRole session={session} loading={loading} requiredRole="admin">
      <div className="page">
        <Header status={status} session={session} onSignOut={() => void signOut()} />
        <div className="section-label">users</div>
        <UsersTable currentUserId={session?.user.id ?? ""} toast={toast} />
        <HealthFooter health={health} />
      </div>
    </RequireRole>
  );
}

function UsersTable({ currentUserId, toast }: { currentUserId: string; toast: ReturnType<typeof useToast> }): JSX.Element {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (): Promise<void> => {
    try {
      setLoading(true);
      setUsers(await getOrgUsers());
    } catch (err) {
      toast.show(`Failed to load users: ${(err as Error).message}`, "err");
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once
  useEffect(() => { void load(); }, []);

  const onRoleToggle = async (user: OrgUser): Promise<void> => {
    const newRole = user.role === "admin" ? "member" : "admin";
    try {
      await patchOrgUser(user.id, { role: newRole });
      toast.show(`${user.email} is now ${newRole}`, "ok");
      await load();
    } catch (err) {
      toast.show((err as Error).message, "err");
    }
  };

  const onStatusToggle = async (user: OrgUser): Promise<void> => {
    const newStatus = user.status === "suspended" ? "active" : "suspended";
    try {
      await patchOrgUser(user.id, { status: newStatus });
      toast.show(`${user.email} is now ${newStatus}`, "ok");
      await load();
    } catch (err) {
      toast.show((err as Error).message, "err");
    }
  };

  if (loading) return <p className="empty">loading...</p>;

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
            <th style={{ padding: "8px 12px" }}>email</th>
            <th style={{ padding: "8px 12px" }}>role</th>
            <th style={{ padding: "8px 12px" }}>status</th>
            <th style={{ padding: "8px 12px" }}>actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 12px" }}>{u.email}</td>
              <td style={{ padding: "8px 12px" }}>{u.role}</td>
              <td style={{ padding: "8px 12px" }}>{u.status}</td>
              <td style={{ padding: "8px 12px", display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="header-signout"
                  onClick={() => void onRoleToggle(u)}
                  disabled={u.id === currentUserId}
                  aria-label={`Toggle role for ${u.email}`}
                >
                  {u.role === "admin" ? "demote" : "promote"}
                </button>
                <button
                  type="button"
                  className="header-signout"
                  onClick={() => void onStatusToggle(u)}
                  aria-label={`Toggle status for ${u.email}`}
                >
                  {u.status === "suspended" ? "reactivate" : "suspend"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 16, fontSize: 12, color: "var(--text-dim)" }}>
        users are provisioned automatically when they sign in with a Google account on the allowed domain.
      </p>
    </>
  );
}
