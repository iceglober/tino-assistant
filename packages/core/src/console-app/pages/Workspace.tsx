import { type JSX, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CapabilityCard, type CapabilityShape } from "../components/CapabilityCard.js";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { TabPanel, Tabs } from "../components/Tabs.js";
import { useToast } from "../hooks/useToast.js";
import type { HealthResponse, OrgUser, Session } from "../lib/api.js";
import {
  addOrgUser,
  getCapabilities,
  getConfig,
  getOrgUsers,
  patchOrgUser,
  putConfig,
  reloadCapabilities,
  reloadSlack,
  restartTino,
} from "../lib/api.js";
import { isCapabilityConnected } from "../lib/capabilityTools.js";

const TABS = [
  { id: "users", label: "Users" },
  { id: "settings", label: "Settings" },
];

export function Workspace(): JSX.Element {
  const { session, health } = useOutletContext<{ session: Session; health: HealthResponse | null }>();
  const isAdmin = session.user.role === "admin";
  const [tab, setTab] = useState("users");

  return (
    <div>
      <h2 className="section-label" style={{ marginTop: 0 }}>
        Workspace
      </h2>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <TabPanel active={tab} id="users">
        <UsersPanel isAdmin={isAdmin} currentUserId={session.user.id} />
      </TabPanel>
      <TabPanel active={tab} id="settings">
        {isAdmin ? (
          <SettingsPanel health={health} />
        ) : (
          <p className="empty" style={{ color: "var(--text-dim)" }}>
            Only admins can edit workspace settings.
          </p>
        )}
      </TabPanel>
    </div>
  );
}

function UsersPanel({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }): JSX.Element {
  const toast = useToast();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  const load = async (): Promise<void> => {
    try {
      setLoading(true);
      setUsers(await getOrgUsers());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once
  useEffect(() => {
    void load();
  }, []);

  const onInvite = async (): Promise<void> => {
    const email = inviteEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.show("Enter a valid email address", "err");
      return;
    }
    setInviting(true);
    try {
      await addOrgUser({ email, role: inviteRole });
      toast.show(`${email} added as ${inviteRole}`, "ok");
      setInviteEmail("");
      await load();
    } catch (err) {
      toast.show((err as Error).message, "err");
    } finally {
      setInviting(false);
    }
  };

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

  return (
    <>
      {isAdmin && (
        <>
          <div className="ws-section">Invite a teammate</div>
          <div className="ws-invite">
            <div className="cap-field" style={{ flex: "1 1 240px" }}>
              <label htmlFor="ws-invite-email">Email</label>
              <input
                id="ws-invite-email"
                className="field-input"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@kayn.ai"
                autoComplete="off"
              />
            </div>
            <div className="cap-field" style={{ flex: "0 0 130px" }}>
              <label htmlFor="ws-invite-role">Role</label>
              <select
                id="ws-invite-role"
                className="field-input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button type="button" className="btn btn-setup" onClick={() => void onInvite()} disabled={inviting}>
              {inviting ? "Adding…" : "Add user"}
            </button>
          </div>
          <p className="section-hint" style={{ marginTop: "calc(-1 * var(--s4))", marginBottom: "var(--s6)" }}>
            Teammates are also provisioned automatically the first time they sign in with a Google account on the
            allowed domain.
          </p>
        </>
      )}

      <div className="ws-section">Members {users.length > 0 && `· ${users.length}`}</div>
      {loading ? (
        <p className="empty">loading…</p>
      ) : error ? (
        <div
          className="cap-req"
          style={{ borderColor: "var(--err-border)", background: "var(--err-bg)", maxWidth: 480 }}
        >
          <div className="cap-req__t">
            <b style={{ color: "var(--err)" }}>Couldn't load members</b>
            <small>A load failure, not an empty team.</small>
          </div>
          <button type="button" className="btn" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : (
        users.map((u) => (
          <div className="ws-row" key={u.id}>
            <div className="ws-row__avatar">{(u.email[0] ?? "?").toUpperCase()}</div>
            <div className="ws-row__m">
              <b>{u.email}</b>
              <small>{u.id === currentUserId ? "you" : u.name || " "}</small>
            </div>
            <span className={`cap-badge ${u.role === "admin" ? "is-blocked" : "is-avail"}`}>{u.role}</span>
            <span
              className={`cap-badge ${u.status === "active" ? "is-active" : u.status === "suspended" ? "is-err" : "is-avail"}`}
            >
              <span className="cap-badge__d" />
              {u.status}
            </span>
            {isAdmin && (
              <div className="ws-row__actions">
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: "var(--t-sm)", padding: "0 6px", opacity: u.id === currentUserId ? 0.4 : 1 }}
                  onClick={() => void onRoleToggle(u)}
                  disabled={u.id === currentUserId}
                >
                  {u.role === "admin" ? "demote" : "promote"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    fontSize: "var(--t-sm)",
                    padding: "0 6px",
                    color: u.status === "suspended" ? "var(--ok)" : "var(--err)",
                  }}
                  onClick={() => void onStatusToggle(u)}
                >
                  {u.status === "suspended" ? "reactivate" : "suspend"}
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}

function SettingsPanel({ health }: { health: HealthResponse | null }): JSX.Element {
  const toast = useToast();

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
        /* ignore */
      } finally {
        setConfigLoaded(true);
      }
    })();
  }, []);

  // ── Slack
  const [slackBotErr, setSlackBotErr] = useState("");
  const [slackAppErr, setSlackAppErr] = useState("");
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

  // ── Agent
  const [modelErr, setModelErr] = useState("");
  const [adminErr, setAdminErr] = useState("");
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

  // ── Shared capabilities
  const [allCaps, setAllCaps] = useState<CapabilityShape[]>([]);

  const loadCaps = async (): Promise<void> => {
    try {
      setAllCaps((await getCapabilities()) as unknown as CapabilityShape[]);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadCaps();
  }, []);

  const sharedCaps = allCaps.filter((c) => c.scope === "shared");

  // ── Restart
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const onRestart = async (): Promise<void> => {
    if (restarting) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("Restart tino? The console will be unreachable for ~30 seconds.");
      if (!ok) return;
    }
    setRestarting(true);
    setRestartError(null);
    const result = await restartTino();
    if (!result.ok) {
      setRestartError(result.error ?? "restart failed");
      setRestarting(false);
      return;
    }
    if (typeof window !== "undefined") window.setTimeout(() => window.location.reload(), 30000);
  };

  if (!configLoaded) return <p className="empty">loading…</p>;

  return (
    <>
      {/* ── Slack ──────────────────────────────────────────────── */}
      <div className="admin-section-label" style={{ marginTop: 0 }}>
        slack
      </div>
      <div style={{ maxWidth: 480 }}>
        <div className="detail-section">
          <div className="detail-label">Bot Token</div>
          <div className="field-group" style={{ marginBottom: 8 }}>
            <RevealInput
              value={slackBot}
              onChange={setSlackBot}
              ariaLabel="Slack Bot Token"
              invalid={!!slackBotErr}
              onBlur={() => setSlackBotErr(validateSlackToken(slackBot, "xoxb-"))}
            />
            <div className={`field-error${slackBotErr ? " visible" : ""}`} role="alert">
              {slackBotErr}
            </div>
          </div>
        </div>
        <div className="detail-section">
          <div className="detail-label">App Token</div>
          <div className="field-group" style={{ marginBottom: 8 }}>
            <RevealInput
              value={slackApp}
              onChange={setSlackApp}
              ariaLabel="Slack App Token"
              invalid={!!slackAppErr}
              onBlur={() => setSlackAppErr(validateSlackToken(slackApp, "xapp-"))}
            />
            <div className={`field-error${slackAppErr ? " visible" : ""}`} role="alert">
              {slackAppErr}
            </div>
          </div>
        </div>
        <div className="btn-row">
          <SaveButton state={slackSave.state} idleLabel="save tokens" size="setup" onClick={onSaveSlack} />
        </div>
      </div>

      {/* ── AI Model ──────────────────────────────────────────── */}
      <div className="admin-section-label">ai model</div>
      <div style={{ maxWidth: 480 }}>
        <div className="detail-section">
          <div className="detail-label">Bedrock Model ID</div>
          <div className="field-group" style={{ marginBottom: 8 }}>
            <input
              className="field-input"
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              autoComplete="off"
              aria-label="Bedrock Model ID"
              aria-invalid={modelErr ? "true" : undefined}
              onBlur={() => setModelErr(!modelId.trim() ? "Model ID is required" : "")}
            />
            <div className={`field-error${modelErr ? " visible" : ""}`} role="alert">
              {modelErr}
            </div>
          </div>
        </div>
        <div className="detail-section">
          <div className="detail-label">Admin Slack User ID</div>
          <div className="field-group" style={{ marginBottom: 8 }}>
            <input
              className="field-input"
              type="text"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              autoComplete="off"
              aria-label="Admin Slack User ID"
              aria-invalid={adminErr ? "true" : undefined}
              onBlur={() => setAdminErr(!adminId.trim() ? "User ID is required" : "")}
            />
            <div className={`field-error${adminErr ? " visible" : ""}`} role="alert">
              {adminErr}
            </div>
          </div>
        </div>
        <div className="btn-row">
          <SaveButton state={agentSave.state} idleLabel="save" size="setup" onClick={onSaveAgent} />
        </div>
      </div>

      {/* ── Shared capabilities ────────────────────────────────── */}
      <div className="admin-section-label">shared capabilities</div>
      <p className="section-hint">available to all users. admin configures once.</p>
      <div className="cap-grid">
        {sharedCaps.length === 0 ? (
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

      {/* ── Danger zone ────────────────────────────────────────── */}
      <div className="admin-danger-zone">
        <div className="admin-section-label" style={{ color: "var(--err)" }}>
          danger zone
        </div>
        <button type="button" className="btn btn-danger" onClick={() => void onRestart()} disabled={restarting}>
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

function RestartOverlay(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="assertive"
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
