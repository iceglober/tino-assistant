import { type JSX, useCallback, useEffect, useState } from "react";
import { Badge } from "../components/Badge.js";
import { CapabilityModal } from "../components/CapabilityModal.js";
import { useToast } from "../hooks/useToast.js";
import { useOutletContext } from "react-router-dom";
import type { CapabilityEntry, HealthResponse, Session } from "../lib/api.js";
import { getUserCapabilities, reloadCapabilities } from "../lib/api.js";

const CAP_META: Record<string, { icon: string; name: string; desc: string }> = {
  github: { icon: "🐙", name: "GitHub", desc: "repos, issues, PRs" },
  calendar: { icon: "📅", name: "Calendar", desc: "Google Calendar events" },
  gmail: { icon: "✉️", name: "Gmail", desc: "search and read email" },
  linear: { icon: "📐", name: "Linear", desc: "issues and projects" },
  cloudwatch: { icon: "☁️", name: "CloudWatch", desc: "AWS logs and metrics" },
  slack: { icon: "💬", name: "Slack", desc: "public channels and content" },
  "slack-personal": { icon: "🔒", name: "Slack (personal)", desc: "DMs, search, and private messages" },
};

export function Capabilities(): JSX.Element {
  const { session } = useOutletContext<{ session: Session; health: HealthResponse | null }>();
  const toast = useToast();
  const userId = session.user.id;

  const [caps, setCaps] = useState<CapabilityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalCap, setModalCap] = useState<CapabilityEntry | null>(null);

  const loadCaps = useCallback(async () => {
    try {
      const data = await getUserCapabilities(userId);
      setCaps(data);
    } catch { /* ignore */ }
    finally { setLoaded(true); }
  }, [userId]);

  useEffect(() => { void loadCaps(); }, [loadCaps]);

  // OAuth callback handling
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (!oauth) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauth === "success") {
      toast.show("Google account connected", "ok");
      void reloadCapabilities().then(() => loadCaps());
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

  const enabledCaps = caps.filter((c) => c.enabled);
  const disabledCaps = caps.filter((c) => !c.enabled);
  const hasGoogleCap = caps.some((c) => (c.id === "gmail" || c.id === "calendar") && c.enabled);

  return (
    <div>
      <h2 className="section-label" style={{ marginTop: 0 }}>Capabilities</h2>
      <p className="section-hint">
        manage your connected integrations. click the gear icon to configure settings and privacy.
      </p>

      {!loaded ? (
        <p className="empty">loading capabilities…</p>
      ) : (
        <>
          {enabledCaps.length > 0 && (
            <div className="cap-grid">
              {enabledCaps.map((cap) => (
                <CapCard key={cap.id} cap={cap} onSettings={() => setModalCap(cap)} />
              ))}
            </div>
          )}

          {!hasGoogleCap && (
            <a
              href="/api/oauth/google/authorize"
              className="cap-card add-cap-card"
              style={{ textDecoration: "none", color: "inherit", display: "block", marginTop: 12, maxWidth: 360 }}
            >
              <div className="cap-card-header">
                <span className="cap-card-icon" style={{ opacity: 0.5 }}>+</span>
                <div className="cap-card-meta">
                  <div className="cap-card-name" style={{ color: "var(--accent)" }}>connect Google</div>
                  <div className="cap-card-desc">Gmail, Calendar — read-only access</div>
                </div>
              </div>
            </a>
          )}

          {disabledCaps.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 24 }}>available</div>
              <div className="cap-grid">
                {disabledCaps.map((cap) => (
                  <CapCard key={cap.id} cap={cap} onSettings={() => setModalCap(cap)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {modalCap && (
        <CapabilityModal
          cap={modalCap}
          userId={userId}
          open
          onClose={() => setModalCap(null)}
          onChanged={() => void loadCaps()}
        />
      )}
    </div>
  );
}

function CapCard({
  cap,
  onSettings,
}: {
  cap: CapabilityEntry;
  onSettings: () => void;
}): JSX.Element {
  const meta = CAP_META[cap.id] ?? { icon: "⚙️", name: cap.displayName ?? cap.id, desc: "" };

  return (
    <div className="cap-card cap-card-compact">
      <div className="cap-card-header">
        <span className="cap-card-icon">{meta.icon}</span>
        <div className="cap-card-meta">
          <div className="cap-card-name">
            {meta.name}
            <Badge variant={cap.scope === "private" ? "private" : "shared"}>
              {cap.scope === "private" ? "Private" : "Shared"}
            </Badge>
          </div>
          <div className="cap-card-desc">{meta.desc}</div>
        </div>
        <div className="cap-card-status">
          {cap.enabled ? (
            <span className="status-connected" style={{ color: "var(--ok)" }}>● on</span>
          ) : (
            <span style={{ fontSize: "0.714rem", color: "var(--text-dim)" }}>off</span>
          )}
        </div>
        <button
          type="button"
          className="cap-settings-btn"
          onClick={(e) => { e.stopPropagation(); onSettings(); }}
          aria-label={`Configure ${meta.name}`}
          title="Settings"
        >
          <svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true">
            <path d="M6.5 1.5h3l.5 2 1.5.7 1.8-1 2.1 2.1-1 1.8.7 1.5 2 .5v3l-2 .5-0.7 1.5 1 1.8-2.1 2.1-1.8-1-1.5.7-.5 2h-3l-.5-2-1.5-.7-1.8 1-2.1-2.1 1-1.8-.7-1.5-2-.5v-3l2-.5.7-1.5-1-1.8 2.1-2.1 1.8 1 1.5-.7.5-2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
