import { type JSX, useEffect, useState } from "react";
import { CapabilityCard, type CapabilityShape } from "../components/CapabilityCard.js";
import { ComplianceSection } from "../components/ComplianceSection.js";
import { ConfigTable } from "../components/ConfigTable.js";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import {
  deleteUserCapability,
  getCapabilities,
  getConfig,
  getUserCapabilities,
  putConfig,
  reloadSlack,
} from "../lib/api.js";
import { isCapabilityConnected } from "../lib/capabilityTools.js";

type Tab = "integrations" | "connections";

export function Console({
  initialSlackBot = "",
  initialSlackApp = "",
  initialModelId = "",
  initialAdminId = "",
}: {
  initialSlackBot?: string;
  initialSlackApp?: string;
  initialModelId?: string;
  initialAdminId?: string;
}): JSX.Element {
  const { session, signOut } = useAuth();
  const { health } = useHealth();
  const toast = useToast();
  const isAdmin = session?.user.role === "admin";
  const userId = session?.user.id;

  const status: "ok" | "degraded" | "unreachable" | "checking" = !health
    ? "checking"
    : health.ok
      ? "ok"
      : "degraded";

  const [tab, setTab] = useState<Tab>(isAdmin ? "integrations" : "connections");

  // ── All capabilities (admin) ────────────────────────────────────────
  const [allCaps, setAllCaps] = useState<CapabilityShape[]>([]);
  const [capsError, setCapsError] = useState<string | null>(null);

  const loadCaps = async (): Promise<void> => {
    if (!isAdmin) return;
    try {
      const data = await getCapabilities();
      setAllCaps(data as unknown as CapabilityShape[]);
      setCapsError(null);
    } catch (err) {
      setCapsError((err as Error).message);
    }
  };

  // ── User's personal capabilities ────────────────────────────────────
  const [userCaps, setUserCaps] = useState<CapabilityShape[]>([]);
  const [userCapsError, setUserCapsError] = useState<string | null>(null);

  const loadUserCaps = async (): Promise<void> => {
    if (!userId) return;
    try {
      const data = await getUserCapabilities(userId);
      setUserCaps(data as unknown as CapabilityShape[]);
      setUserCapsError(null);
    } catch (err) {
      setUserCapsError((err as Error).message);
    }
  };

  useEffect(() => {
    void loadCaps();
    void loadUserCaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);

  const sharedCaps = allCaps.filter((c) => c.scope === "shared");
  const privateCaps = allCaps.filter((c) => c.scope === "private");

  const onDeleteUserCap = async (capId: string): Promise<void> => {
    if (!userId) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Remove ${capId} from your personal capabilities?`);
      if (!ok) return;
    }
    try {
      await deleteUserCapability(userId, capId);
      toast.show("Capability removed", "ok");
      await loadUserCaps();
    } catch (err) {
      toast.show(`Could not delete: ${(err as Error).message}`, "err");
    }
  };

  // ── Slack edit ──────────────────────────────────────────────────────
  const [slackBot, setSlackBot] = useState(initialSlackBot);
  const [slackApp, setSlackApp] = useState(initialSlackApp);
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

  // ── Agent edit ──────────────────────────────────────────────────────
  const [modelId, setModelId] = useState(initialModelId);
  const [adminId, setAdminId] = useState(initialAdminId);
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

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={() => void signOut()} />

      {/* Tab bar */}
      <div className="tab-bar">
        {isAdmin ? (
          <button
            type="button"
            className={`tab-btn${tab === "integrations" ? " active" : ""}`}
            onClick={() => setTab("integrations")}
          >
            integrations
          </button>
        ) : null}
        <button
          type="button"
          className={`tab-btn${tab === "connections" ? " active" : ""}`}
          onClick={() => setTab("connections")}
        >
          my connections
        </button>
      </div>

      {/* ── Integrations tab (admin) ─────────────────────────────────── */}
      {tab === "integrations" && isAdmin ? (
        <>
          <div className="section-label">shared capabilities</div>
          <p className="section-hint">
            Available to all users. Admin configures once.
          </p>
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

          <div className="section-label" style={{ marginTop: 32 }}>core config</div>
          <div className="cap-grid" style={{ marginBottom: 28 }}>
            {/* Slack card */}
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
                  <span className="status-connected">● connected</span>
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

            {/* Agent card */}
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
                  <span className="status-connected">● configured</span>
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

          <ConfigTable />
          <ComplianceSection />
        </>
      ) : null}

      {/* ── My Connections tab ───────────────────────────────────────── */}
      {tab === "connections" ? (
        <>
          <div className="section-label">personal capabilities</div>
          <p className="section-hint">
            Each user connects their own accounts. Your credentials are encrypted and only used for your requests.
          </p>
          <div className="cap-grid">
            {isAdmin && privateCaps.length > 0 ? (
              privateCaps.map((cap) => {
                const userCap = userCaps.find((uc) => uc.id === cap.id);
                const merged: CapabilityShape = {
                  ...cap,
                  enabled: userCap?.enabled ?? cap.enabled,
                  fields: userCap?.fields ?? cap.fields,
                  connected: health ? isCapabilityConnected(cap.id, health.tools) : undefined,
                };
                return (
                  <div key={cap.id} style={{ position: "relative" }}>
                    <CapabilityCard cap={merged} onChanged={() => { void loadCaps(); void loadUserCaps(); }} />
                    {userCap ? (
                      <button
                        type="button"
                        className="cap-delete-btn"
                        onClick={() => void onDeleteUserCap(cap.id)}
                        style={{
                          position: "absolute", top: 16, right: 16,
                          background: "var(--err)", color: "white", border: "none",
                          borderRadius: 4, padding: "6px 12px", fontSize: 12,
                          fontWeight: 500, cursor: "pointer", opacity: 0.8,
                        }}
                      >
                        disconnect
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : userCapsError ? (
              <p className="empty">error loading capabilities: {userCapsError}</p>
            ) : userCaps.length === 0 && !isAdmin ? (
              <p className="empty">no personal capabilities configured yet</p>
            ) : !isAdmin ? (
              userCaps.map((cap) => (
                <div key={cap.id} style={{ position: "relative" }}>
                  <CapabilityCard cap={cap} onChanged={loadUserCaps} />
                  <button
                    type="button"
                    className="cap-delete-btn"
                    onClick={() => void onDeleteUserCap(cap.id)}
                    style={{
                      position: "absolute", top: 16, right: 16,
                      background: "var(--err)", color: "white", border: "none",
                      borderRadius: 4, padding: "6px 12px", fontSize: 12,
                      fontWeight: 500, cursor: "pointer", opacity: 0.8,
                    }}
                  >
                    disconnect
                  </button>
                </div>
              ))
            ) : null}
          </div>
        </>
      ) : null}

      <HealthFooter health={health} />
    </div>
  );
}

export async function fetchInitialConsoleValues(): Promise<{
  slackBot: string;
  slackApp: string;
  modelId: string;
  adminId: string;
}> {
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
  return {
    slackBot: get("slack.botToken"),
    slackApp: get("slack.appToken"),
    modelId: get("bedrock.modelId"),
    adminId: get("slack.adminUserId"),
  };
}
