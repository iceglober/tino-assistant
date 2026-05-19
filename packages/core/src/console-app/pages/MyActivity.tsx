import { type JSX, useEffect, useState } from "react";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { type AuditEntryView, getAuditEntries } from "../lib/api.js";

export function MyActivity(): JSX.Element {
  const { session, signOut } = useAuth();
  const { health } = useHealth();
  const status: "ok" | "degraded" | "unreachable" | "checking" = !health ? "checking" : health.ok ? "ok" : "degraded";

  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={() => void signOut()} />
      <div className="section-label">my activity</div>
      <ActivityTable />
      <HealthFooter health={health} />
    </div>
  );
}

function ActivityTable(): JSX.Element {
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setEntries(await getAuditEntries({ limit: 200 }));
      } catch {
        /* empty state */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="empty">loading...</p>;
  if (entries.length === 0) return <p className="empty">no activity yet</p>;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
          <th style={{ padding: "8px 12px" }}>time</th>
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
            <td style={{ padding: "8px 12px" }}>{e.action}</td>
            <td style={{ padding: "8px 12px" }}>{e.toolName ?? "-"}</td>
            <td style={{ padding: "8px 12px", color: e.status === "error" || e.status === "denied" ? "var(--err)" : undefined }}>
              {e.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
