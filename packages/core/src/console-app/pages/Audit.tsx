import { type JSX, useEffect, useState } from "react";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { RequireRole } from "../components/RequireRole.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { type AuditEntryView, getAuditEntries } from "../lib/api.js";

export function Audit(): JSX.Element {
  const { session, signOut } = useAuth();
  const { health } = useHealth();
  const status: "ok" | "degraded" | "unreachable" | "checking" = !health ? "checking" : health.ok ? "ok" : "degraded";

  return (
    <RequireRole session={session} requiredRole="admin">
      <div className="page">
        <Header status={status} session={session} onSignOut={() => void signOut()} />
        <div className="section-label">audit log</div>
        <AuditTable />
        <HealthFooter health={health} />
      </div>
    </RequireRole>
  );
}

function AuditTable(): JSX.Element {
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [limit, setLimit] = useState(100);

  const load = async (): Promise<void> => {
    try {
      setLoading(true);
      setEntries(
        await getAuditEntries({
          action: actionFilter || undefined,
          limit,
        }),
      );
    } catch {
      /* handled by empty state */
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on filter change
  useEffect(() => { void load(); }, [actionFilter, limit]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{ padding: "6px 8px", fontSize: 13, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
        >
          <option value="">all actions</option>
          <option value="tool_call">tool_call</option>
          <option value="config_change">config_change</option>
          <option value="login">login</option>
          <option value="role_change">role_change</option>
          <option value="injection_suspected">injection_suspected</option>
          <option value="capability_toggle">capability_toggle</option>
        </select>
        <select
          value={String(limit)}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{ padding: "6px 8px", fontSize: 13, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
        >
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
        </select>
      </div>
      {loading ? (
        <p className="empty">loading...</p>
      ) : entries.length === 0 ? (
        <p className="empty">no audit entries</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px" }}>time</th>
              <th style={{ padding: "8px 12px" }}>user</th>
              <th style={{ padding: "8px 12px" }}>action</th>
              <th style={{ padding: "8px 12px" }}>tool</th>
              <th style={{ padding: "8px 12px" }}>status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.timestamp}-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>
                  {new Date(e.timestamp).toLocaleString()}
                </td>
                <td style={{ padding: "8px 12px" }}>{e.userId}</td>
                <td style={{ padding: "8px 12px" }}>{e.action}</td>
                <td style={{ padding: "8px 12px" }}>{e.toolName ?? "-"}</td>
                <td style={{ padding: "8px 12px", color: e.status === "error" || e.status === "denied" ? "var(--err)" : undefined }}>
                  {e.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
