import { type JSX, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CapabilityCard, type CapabilityShape } from "../components/CapabilityCard.js";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import {
  deleteUserCapability,
  getConfig,
  getPrivacyStatus,
  getUserCapabilities,
  putConfig,
  reloadCapabilities,
  reloadSlack,
} from "../lib/api.js";

export function Home(): JSX.Element {
  const { session, signOut } = useAuth();
  const { health } = useHealth();
  const toast = useToast();
  const navigate = useNavigate();
  const isAdmin = session?.user.role === "admin";
  const userId = session?.user.id;

  const status: "ok" | "degraded" | "unreachable" | "checking" = !health
    ? "checking"
    : health.ok
      ? "ok"
      : "degraded";

  // ── Privacy CTA state ───────────────────────────────────────────────
  const [hasPrivacyConfig, setHasPrivacyConfig] = useState(true);
  const [hasConnectedCaps, setHasConnectedCaps] = useState(false);

  // ── Setup banner state (admin only) ─────────────────────────────────
  const [hasSlack, setHasSlack] = useState(true);
  const [hasModel, setHasModel] = useState(true);
  const [setupLoaded, setSetupLoaded] = useState(false);

  // ── User capabilities ───────────────────────────────────────────────
  const [userCaps, setUserCaps] = useState<CapabilityShape[]>([]);
  const [userCapsError, setUserCapsError] = useState<string | null>(null);
  const [userCapsLoaded, setUserCapsLoaded] = useState(false);

  const loadUserCaps = async (): Promise<void> => {
    if (!userId) {
      setUserCapsLoaded(true);
      return;
    }
    try {
      const data = await getUserCapabilities(userId);
      setUserCaps(data as unknown as CapabilityShape[]);
      setUserCapsError(null);
    } catch (err) {
      setUserCapsError((err as Error).message);
    } finally {
      setUserCapsLoaded(true);
    }
  };

  useEffect(() => {
    void loadUserCaps();
    void getPrivacyStatus()
      .then((s) => {
        setHasPrivacyConfig(s.hasPrivacyConfig);
        setHasConnectedCaps(s.connectedCapabilities.length > 0);
      })
      .catch(() => {});

    if (isAdmin) {
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
          setHasSlack(!!(get("slack.botToken") && get("slack.appToken")));
          setHasModel(!!(get("bedrock.modelId") && get("slack.adminUserId")));
        } catch {
          setHasSlack(false);
          setHasModel(false);
        } finally {
          setSetupLoaded(true);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, userId]);

  // ── OAuth callback handling ─────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (!oauth) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauth === "success") {
      toast.show("Google account connected", "ok");
      void reloadCapabilities().then(async () => {
        await loadUserCaps();
        navigate("/privacy");
      });
    } else if (oauth === "denied") {
      toast.show("Google OAuth consent was denied", "err");
    } else if (oauth === "no_refresh_token") {
      toast.show("Google did not return a refresh token — revoke access at myaccount.google.com/permissions and try again", "err");
    } else if (oauth === "expired" || oauth === "mismatch") {
      toast.show("OAuth session expired — try again", "err");
    } else if (oauth === "error") {
      toast.show("Google OAuth failed — check server logs", "err");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDeleteUserCap = async (capId: string): Promise<void> => {
    if (!userId) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Remove ${capId} from your personal capabilities?`);
      if (!ok) return;
    }
    try {
      await deleteUserCapability(userId, capId);
      toast.show("Capability removed", "ok");
      await reloadCapabilities();
      await loadUserCaps();
    } catch (err) {
      toast.show(`Could not delete: ${(err as Error).message}`, "err");
    }
  };

  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={() => void signOut()} />

      {/* Admin setup banner — inline form for first-time config */}
      {isAdmin && setupLoaded && !hasSlack && (
        <SlackSetupBanner
          onComplete={() => {
            setHasSlack(true);
          }}
        />
      )}
      {isAdmin && setupLoaded && hasSlack && !hasModel && (
        <ModelSetupBanner
          onComplete={() => {
            setHasModel(true);
          }}
        />
      )}

      {/* Privacy CTA */}
      {hasConnectedCaps && !hasPrivacyConfig && (
        <div className="privacy-banner">
          <div>
            <strong>privacy setup needed</strong>
            <span style={{ marginLeft: 8, color: "var(--text-dim)" }}>
              configure what tino stores before it starts persisting your data.
            </span>
          </div>
          <button className="btn btn-primary-lg" type="button" onClick={() => navigate("/privacy")}>
            configure privacy
          </button>
        </div>
      )}

      {/* My Connections */}
      <div className="section-label">my connections</div>
      <p className="section-hint">
        each user connects their own accounts. your credentials are encrypted and only used for your requests.
      </p>
      <div className="cap-grid">
        {userCapsError ? (
          <p className="empty">error loading capabilities: {userCapsError}</p>
        ) : !userCapsLoaded ? (
          <p className="empty">loading capabilities…</p>
        ) : userCaps.length === 0 ? (
          <p className="empty" style={{ color: "var(--text-dim)" }}>
            {userId ? "no personal capabilities configured yet." : "sign in to connect your accounts."}
          </p>
        ) : (
          userCaps.map((cap) => {
            const isGoogleCap = cap.id === "gmail" || cap.id === "calendar";
            return (
              <div key={cap.id} style={{ position: "relative" }}>
                <CapabilityCard
                  cap={{
                    ...cap,
                    connected: cap.enabled ? true : undefined,
                    oauthUrl: isGoogleCap ? "/api/oauth/google/authorize" : undefined,
                    userId,
                  }}
                  onChanged={loadUserCaps}
                />
                {cap.enabled ? (
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
        )}
      </div>

      <HealthFooter health={health} />
    </div>
  );
}

function SlackSetupBanner({ onComplete }: { onComplete: () => void }): JSX.Element {
  const toast = useToast();
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [botErr, setBotErr] = useState("");
  const [appErr, setAppErr] = useState("");
  const slackSave = useSaveState();

  const validate = (val: string, prefix: string): string => {
    if (!val.trim()) return "Token is required.";
    if (!val.trim().startsWith(prefix)) return `Token must start with ${prefix}`;
    return "";
  };

  const onConnect = async (): Promise<void> => {
    const be = validate(botToken, "xoxb-");
    const ae = validate(appToken, "xapp-");
    setBotErr(be);
    setAppErr(ae);
    if (be || ae) return;

    const ok = await slackSave.run(async () => {
      await putConfig("slack.botToken", botToken.trim());
      await putConfig("slack.appToken", appToken.trim());
    });
    if (ok) {
      toast.show("Slack connected", "ok");
      onComplete();
    } else {
      toast.show("Could not save tokens", "err");
    }
  };

  return (
    <div className="setup-banner">
      <div className="setup-banner-header">connect tino to Slack</div>
      <p className="setup-banner-desc">
        tino lives in Slack. add your bot and app tokens to start receiving requests.
      </p>
      <div className="setup-banner-fields">
        <div className="field-group" style={{ marginBottom: 8 }}>
          <label className="field-label" htmlFor="setup-bot">Bot Token <span className="field-label-mono">xoxb-…</span></label>
          <RevealInput id="setup-bot" value={botToken} onChange={setBotToken} ariaLabel="Slack Bot Token" invalid={!!botErr} onBlur={() => setBotErr(validate(botToken, "xoxb-"))} />
          <div className={`field-error${botErr ? " visible" : ""}`} role="alert" aria-live="polite">{botErr}</div>
        </div>
        <div className="field-group" style={{ marginBottom: 8 }}>
          <label className="field-label" htmlFor="setup-app">App Token <span className="field-label-mono">xapp-…</span></label>
          <RevealInput id="setup-app" value={appToken} onChange={setAppToken} ariaLabel="Slack App Token" invalid={!!appErr} onBlur={() => setAppErr(validate(appToken, "xapp-"))} />
          <div className={`field-error${appErr ? " visible" : ""}`} role="alert" aria-live="polite">{appErr}</div>
        </div>
      </div>
      <div className="btn-row">
        <SaveButton state={slackSave.state} idleLabel="connect Slack" savingLabel="connecting…" savedLabel="connected" size="setup" onClick={onConnect} />
      </div>
    </div>
  );
}

function ModelSetupBanner({ onComplete }: { onComplete: () => void }): JSX.Element {
  const toast = useToast();
  const [modelId, setModelId] = useState("");
  const [adminId, setAdminId] = useState("");
  const [modelErr, setModelErr] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const save = useSaveState();

  const onSave = async (): Promise<void> => {
    const me = !modelId.trim() ? "Model ID is required" : "";
    const ae = !adminId.trim() ? "User ID is required" : "";
    setModelErr(me);
    setAdminErr(ae);
    if (me || ae) return;

    const ok = await save.run(async () => {
      await putConfig("bedrock.modelId", modelId.trim());
      await putConfig("slack.adminUserId", adminId.trim());
    });
    if (ok) {
      const reload = await reloadSlack();
      if (!reload.ok) {
        toast.show(`Config saved, but Slack connect failed: ${reload.error ?? "unknown"}`, "err");
      } else {
        toast.show("Setup complete", "ok");
      }
      onComplete();
    } else {
      toast.show("Could not save config", "err");
    }
  };

  return (
    <div className="setup-banner">
      <div className="setup-banner-check">Slack connected</div>
      <div className="setup-banner-header">configure the AI model</div>
      <p className="setup-banner-desc">
        which Bedrock model to use, and your Slack user ID so tino knows who the admin is.
      </p>
      <div className="setup-banner-fields">
        <div className="field-group" style={{ marginBottom: 8 }}>
          <label className="field-label" htmlFor="setup-model">Bedrock Model ID</label>
          <input id="setup-model" className="field-input" type="text" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="us.anthropic.claude-sonnet-4-5-20251101-v1:0" autoComplete="off" aria-invalid={modelErr ? "true" : undefined} onBlur={() => setModelErr(!modelId.trim() ? "Model ID is required" : "")} />
          <div className={`field-error${modelErr ? " visible" : ""}`} role="alert" aria-live="polite">{modelErr}</div>
        </div>
        <div className="field-group" style={{ marginBottom: 8 }}>
          <label className="field-label" htmlFor="setup-admin">Your Slack User ID</label>
          <input id="setup-admin" className="field-input" type="text" value={adminId} onChange={(e) => setAdminId(e.target.value)} placeholder="U0123456789" autoComplete="off" aria-invalid={adminErr ? "true" : undefined} onBlur={() => setAdminErr(!adminId.trim() ? "User ID is required" : "")} />
          <div className={`field-error${adminErr ? " visible" : ""}`} role="alert" aria-live="polite">{adminErr}</div>
        </div>
      </div>
      <div className="btn-row">
        <SaveButton state={save.state} idleLabel="finish setup" savingLabel="saving…" savedLabel="done" size="setup" onClick={onSave} />
      </div>
    </div>
  );
}
