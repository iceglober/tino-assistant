import { type JSX, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge.js";
import { useToast } from "../hooks/useToast.js";
import type { ActivityItem, CapabilityEntry, Session } from "../lib/api.js";
import {
  getRecentActivity,
  getUserCapabilities,
  reloadCapabilities,
} from "../lib/api.js";

const CAP_META: Record<string, { icon: string; name: string; desc: string }> = {
  github: { icon: "🐙", name: "GitHub", desc: "repos, issues, PRs" },
  calendar: { icon: "📅", name: "Calendar", desc: "Google Calendar events" },
  gmail: { icon: "✉️", name: "Gmail", desc: "search and read email" },
  linear: { icon: "📐", name: "Linear", desc: "issues and projects" },
  cloudwatch: { icon: "☁️", name: "CloudWatch", desc: "AWS logs and metrics" },
  slack: { icon: "💬", name: "Slack", desc: "public channels and content" },
  "slack-personal": { icon: "🔒", name: "Slack (personal)", desc: "DMs, search, and private messages" },
};

export function Dashboard({
  session,
  signOut: _signOut,
  onRecheck,
}: {
  session: Session;
  signOut: () => Promise<void>;
  onRecheck: () => void;
}): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";

  const [caps, setCaps] = useState<CapabilityEntry[]>([]);
  const [capsLoaded, setCapsLoaded] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoaded, setActivityLoaded] = useState(false);

  const loadCaps = useCallback(async () => {
    try {
      const data = await getUserCapabilities(userId);
      setCaps(data);
    } catch { /* ignore */ }
    finally { setCapsLoaded(true); }
  }, [userId]);

  useEffect(() => { void loadCaps(); }, [loadCaps]);

  useEffect(() => {
    void (async () => {
      try {
        const items = await getRecentActivity(20);
        setActivity(items);
      } catch { /* ignore — activity is non-critical */ }
      finally { setActivityLoaded(true); }
    })();
  }, []);

  // OAuth callback handling
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (!oauth) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauth === "success") {
      toast.show("Google account connected", "ok");
      void reloadCapabilities().then(async () => {
        await loadCaps();
        onRecheck();
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

  const enabledCaps = caps.filter((c) => c.enabled);
  const hasGoogleCap = enabledCaps.some((c) => c.id === "gmail" || c.id === "calendar");

  return (
    <div>
      {/* ── Capabilities grid ─────────────────────────────────────── */}
      <div className="section-label" style={{ marginTop: 0 }}>capabilities</div>
      <p className="section-hint">
        your connected integrations.{" "}
        <button
          type="button"
          className="link-btn"
          onClick={() => navigate("/capabilities")}
        >
          manage →
        </button>
      </p>

      <div className="cap-grid">
        {!capsLoaded ? (
          <p className="empty">loading…</p>
        ) : enabledCaps.length === 0 ? (
          <p className="empty" style={{ color: "var(--text-dim)" }}>
            no capabilities connected yet.
          </p>
        ) : (
          enabledCaps.map((cap) => {
            const meta = CAP_META[cap.id] ?? { icon: "⚙️", name: cap.displayName ?? cap.id, desc: "" };
            return (
              <button
                key={cap.id}
                type="button"
                className="cap-card cap-card-compact"
                onClick={() => navigate("/capabilities")}
              >
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
                    <span className="status-connected" style={{ color: "var(--ok)" }}>● on</span>
                  </div>
                </div>
              </button>
            );
          })
        )}

        {!hasGoogleCap && capsLoaded && (
          <a
            href="/api/oauth/google/authorize"
            className="cap-card add-cap-card"
            style={{ textDecoration: "none", color: "inherit" }}
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
      </div>

      {/* ── Activity feed ─────────────────────────────────────────── */}
      <div className="section-label" style={{ marginTop: 28 }}>recent activity</div>
      <div className="activity-feed">
        {!activityLoaded ? (
          <p className="empty">loading…</p>
        ) : activity.length === 0 ? (
          <p className="empty" style={{ color: "var(--text-dim)" }}>
            no recent activity.
          </p>
        ) : (
          activity.map((item) => (
            <div key={item.id} className="activity-item">
              <div className="activity-dot" data-status={item.status} />
              <div className="activity-body">
                <span className="activity-summary">{item.summary}</span>
                <span className="activity-time">{formatRelative(item.timestamp)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {isAdmin && (
        <div style={{ marginTop: 28 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ color: "var(--accent)", padding: 0, fontSize: "0.857rem" }}
            onClick={() => navigate("/workspace")}
          >
            workspace settings →
          </button>
          <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginTop: 4 }}>
            Slack tokens, model config, shared capabilities, users
          </p>
        </div>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
