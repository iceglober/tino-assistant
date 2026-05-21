import { type JSX, useEffect, useState } from "react";
import { CapabilityCard, type CapabilityShape } from "../components/CapabilityCard.js";
import { ComplianceSection } from "../components/ComplianceSection.js";
import { ConfigTable } from "../components/ConfigTable.js";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { RequireRole } from "../components/RequireRole.js";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import {
  getCapabilities,
  getConfig,
  getOrgUsers,
  type OrgUser,
  patchOrgUser,
  putConfig,
  reloadCapabilities,
  reloadSlack,
  restartTino,
} from "../lib/api.js";
import { isCapabilityConnected } from "../lib/capabilityTools.js";

export function Admin(): JSX.Element {
  const { session, loading: authLoading, signOut } = useAuth();
  const { health } = useHealth();
  const status: "ok" | "degraded" | "unreachable" | "checking" = !health
    ? "checking"
    : health.ok
      ? "ok"
      : "degraded";

  return (
    <RequireRole session={session} loading={authLoading} requiredRole="admin">
      <div className="page">
        <Header status={status} session={session} onSignOut={() => void signOut()} />
        <div className="section-label">admin panel</div>
        <AdminPanel health={health} currentUserId={session?.user.id ?? ""} />
        <HealthFooter health={health} />
      </div>
    </RequireRole>
  );
}

function AdminPanel({
  health,
  currentUserId,
}: {
  health: ReturnType<typeof useHealth>["health"];
  currentUserId: string;
}): JSX.Element {
  const toast = useToast();

  // ── Load initial config values ──────────────────────────────────────
  const [slackBot, setSlackBot] = useState("");
  const [slackApp, setSlackApp] = useState("");
  const [modelId, setModelId] = useState("");
  const [adminId, setAdminId] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const entries = await getConfig();
        const get = (k: string): string => {
          const e = entries.find((x) => x.key === k);
          if (!e) return "";
          try {
            return String(JSON.parse(e.value));
          } catch {
            return e.value;
          }
        };
        setSlackBot(get("slack.botToken"));
        setSlackApp(get("slack.appToken"));
        setModelId(get("bedrock.modelId"));
        setAdminId(get("slack.adminUserId"));
      } catch {
        /* config may not be available yet */
      } finally {
        setConfigLoaded(true);
      }
    })();
  }, []);

  // ── Slack config ────────────────────────────────────────────────────
  const [slackBotErr, setSlackBotErr] = useState("");
  const [slackAppErr, setSlackAppErr] = useState("");
  const [slackOpen, setSlackOpen] = useState(false);
  const slackSave = useSaveState();

  const validateSlackToken = (val: string, prefix: string): string => {
    if (!val.trim()) return "Token is required.";
    if (!val.trim().startsWith(prefix)) return `Token must start with ${prefix}`;
    return "";
  };

  const onSaveSlack = async (): Promise<void> => {
    const be = validateSlackToken(slackBot, "xoxb-");
    const ae = validateSlackToken(slackApp, "xapp-");
    setSlackBotErr(be);
    setSlackAppErr(ae);
    if (be || ae) return;

    const ok = await slackSave.run(async () => {
      await putConfig("slack.botToken", slackBot.trim());
      await putConfig("slack.appToken", slackApp.trim());
    });
    if (!ok) {
      toast.show("Could not save tokens", "err");
      return;
    }
    const reload = await reloadSlack();
    if (reload.ok) toast.show("Slack tokens updated — reconnected", "ok");
    else toast.show(`Saved, but reconnect failed: ${reload.error ?? "unknown"}`, "err");
  };

  // ── Agent config ────────────────────────────────────────────────────
  const [modelErr, setModelErr] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const agentSave = useSaveState();

  const onSaveAgent = async (): Promise<void> => {
    const me = !modelId.trim() ? "Model ID is required" : "";
    const ae = !adminId.trim() ? "User ID is required" : "";
    setModelErr(me);
    setAdminErr(ae);
    if (me || ae) return;

    const ok = await agentSave.run(async () => {
      await putConfig("bedrock.modelId", modelId.trim());
      await putConfig("slack.adminUserId", adminId.trim());
    });
    if (ok) toast.show("Agent config updated", "ok");
    else toast.show("Could not save", "err");
  };

  // ── Shared capabilities ─────────────────────────────────────────────
  const [allCaps, setAllCaps] = useState<CapabilityShape[]>([]);
  const [capsError, setCapsError] = useState<string | null>(null);

  const loadCaps = async (): Promise<void> => {
    try {
      const data = await getCapabilities();
      setAllCaps(data as unknown as CapabilityShape[]);
      setCapsError(null);
    } catch (err) {
      setCapsError((err as Error).message);
    }
  };

  useEffect(() => {
    void loadCaps();
  }, []);

  const sharedCaps = allCaps.filter((c) => c.scope === "shared");

  // ── Restart ─────────────────────────────────────────────────────────
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

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
    if (typeof window !== "undefined") {
      window.setTimeout(() => window.location.reload(), 30000);
    }
  };

  if (!configLoaded) return <p className="empty">loading…</p>;

  return (
    <>
      {/* ── Slack ────────────────────────────────────────────────── */}
      <div className="admin-section-label">slack</div>
      <div className="cap-grid">
        <div className={`cap-card${slackOpen ? " open" : ""}`}>
          <div
            className="cap-card-header"
            role="button"
            tabIndex={0}
            aria-expanded={slackOpen}
            onClick={() => setSlackOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSlackOpen((v) => !v);
              }
            }}
          >
            <span className="cap-card-icon">💬</span>
            <div className="cap-card-meta">
              <div className="cap-card-name">Slack</div>
              <div className="cap-card-desc">bot + app tokens</div>
            </div>
            <div className="cap-card-status">
              {slackBot ? (
                <span className="status-connected">● connected</span>
              ) : (
                <span style={{ fontSize: "0.714rem", color: "var(--text-dim)" }}>not configured</span>
              )}
            </div>
            <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="cap-detail-wrap">
            <div className="cap-detail-inner">
              <div className="cap-detail">
                <div className="detail-section">
                  <div className="detail-label">Bot Token</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <RevealInput value={slackBot} onChange={setSlackBot} ariaLabel="Slack Bot Token" invalid={!!slackBotErr} onBlur={() => setSlackBotErr(validateSlackToken(slackBot, "xoxb-"))} />
                    <div className={`field-error${slackBotErr ? " visible" : ""}`} role="alert" aria-live="polite">{slackBotErr}</div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">App Token</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <RevealInput value={slackApp} onChange={setSlackApp} ariaLabel="Slack App Token" invalid={!!slackAppErr} onBlur={() => setSlackAppErr(validateSlackToken(slackApp, "xapp-"))} />
                    <div className={`field-error${slackAppErr ? " visible" : ""}`} role="alert" aria-live="polite">{slackAppErr}</div>
                  </div>
                </div>
                <div className="btn-row">
                  <SaveButton state={slackSave.state} idleLabel="save tokens" size="setup" onClick={onSaveSlack} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── AI Model ─────────────────────────────────────────────── */}
      <div className="admin-section-label">ai model</div>
      <div className="cap-grid">
        <div className={`cap-card${agentOpen ? " open" : ""}`}>
          <div
            className="cap-card-header"
            role="button"
            tabIndex={0}
            aria-expanded={agentOpen}
            onClick={() => setAgentOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAgentOpen((v) => !v);
              }
            }}
          >
            <span className="cap-card-icon">🤖</span>
            <div className="cap-card-meta">
              <div className="cap-card-name">Agent</div>
              <div className="cap-card-desc">model + admin user</div>
            </div>
            <div className="cap-card-status">
              {modelId ? (
                <span className="status-connected">● configured</span>
              ) : (
                <span style={{ fontSize: "0.714rem", color: "var(--text-dim)" }}>not configured</span>
              )}
            </div>
            <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="cap-detail-wrap">
            <div className="cap-detail-inner">
              <div className="cap-detail">
                <div className="detail-section">
                  <div className="detail-label">Bedrock Model ID</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <input className="field-input" type="text" value={modelId} onChange={(e) => setModelId(e.target.value)} autoComplete="off" aria-label="Bedrock Model ID" aria-invalid={modelErr ? "true" : undefined} onBlur={() => setModelErr(!modelId.trim() ? "Model ID is required" : "")} />
                    <div className={`field-error${modelErr ? " visible" : ""}`} role="alert" aria-live="polite">{modelErr}</div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">Admin User ID</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <input className="field-input" type="text" value={adminId} onChange={(e) => setAdminId(e.target.value)} autoComplete="off" aria-label="Admin Slack User ID" aria-invalid={adminErr ? "true" : undefined} onBlur={() => setAdminErr(!adminId.trim() ? "User ID is required" : "")} />
                    <div className={`field-error${adminErr ? " visible" : ""}`} role="alert" aria-live="polite">{adminErr}</div>
                  </div>
                </div>
                <div className="btn-row">
                  <SaveButton state={agentSave.state} idleLabel="save" size="setup" onClick={onSaveAgent} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Shared capabilities ──────────────────────────────────── */}
      <div className="admin-section-label">shared capabilities</div>
      <p className="section-hint">available to all users. admin configures once.</p>
      <div className="cap-grid">
        {capsError ? (
          <p className="empty">error loading capabilities: {capsError}</p>
        ) : sharedCaps.length === 0 ? (
          <p className="empty">no shared capabilities</p>
        ) : (
          sharedCaps.map((cap) => (
            <CapabilityCard
              key={cap.id}
              cap={{
                ...cap,
                connected: health ? isCapabilityConnected(cap.id, health.tools) : undefined,
              }}
              onChanged={loadCaps}
            />
          ))
        )}
      </div>

      {/* ── Users ────────────────────────────────────────────────── */}
      <div className="admin-section-label">users</div>
      <UsersTable currentUserId={currentUserId} toast={toast} />

      {/* ── Compliance + Config ──────────────────────────────────── */}
      <ComplianceSection />
      <ConfigTable />

      {/* ── Danger zone ──────────────────────────────────────────── */}
      <div className="admin-danger-zone">
        <div className="admin-section-label" style={{ color: "var(--err)" }}>danger zone</div>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void onRestart()}
          disabled={restarting}
        >
          {restarting ? "restarting…" : "restart tino"}
        </button>
        {restartError && (
          <div role="alert" style={{ color: "var(--err)", fontSize: "0.857rem", marginTop: 8 }}>
            {restartError}
          </div>
        )}
        <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginTop: 8 }}>
          restarts the ECS task. the console will be unreachable for ~30 seconds.
        </p>
      </div>

      {restarting && <RestartOverlay />}
    </>
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
