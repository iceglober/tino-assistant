import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CapabilityRow } from "../components/CapabilityRow.js";
import { McpServersDetail } from "../components/McpServersDetail.js";
import { TabPanel, Tabs } from "../components/Tabs.js";
import { useToast } from "../hooks/useToast.js";
import type {
  CapabilityEntry,
  DiscoveryProgress,
  DiscoveryResult,
  HealthResponse,
  McpServer,
  Session,
} from "../lib/api.js";
import {
  getDiscoveryResult,
  getMcpServers,
  getUserCapabilities,
  getUserPreferences,
  reloadCapabilities,
  startDiscovery,
} from "../lib/api.js";
import { CAP_META } from "../lib/capabilityMeta.js";

const RELATIONSHIP_LABELS: Record<string, string> = {
  "reports-to": "reports to",
  "direct-report": "direct report",
  peer: "peer",
  stakeholder: "stakeholder",
  "cross-functional": "cross-functional",
  external: "external",
  "frequent-contact": "frequent contact",
};

const TIME_HORIZON_ORDER = ["daily", "weekly", "monthly", "quarterly", "ongoing"] as const;

const PAGE_TABS = [
  { id: "tools", label: "Capabilities" },
  { id: "preferences", label: "Your profile" },
  { id: "memory", label: "What tino remembers" },
];

export function Capabilities(): JSX.Element {
  const { session } = useOutletContext<{ session: Session; health: HealthResponse | null }>();
  const toast = useToast();
  const userId = session.user.id;

  const [tab, setTab] = useState("tools");
  const [caps, setCaps] = useState<CapabilityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLoaded, setMcpLoaded] = useState(false);

  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryLoaded, setDiscoveryLoaded] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunProgress, setRerunProgress] = useState<DiscoveryProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadCaps = useCallback(async () => {
    try {
      const data = await getUserCapabilities(userId);
      setCaps(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [userId]);

  const loadMcp = useCallback(async () => {
    try {
      setMcpServers(await getMcpServers());
    } catch {
      /* MCP unavailable — leave list empty */
    } finally {
      setMcpLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadCaps();
  }, [loadCaps]);

  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  useEffect(() => {
    void (async () => {
      try {
        const result = await getDiscoveryResult();
        setDiscovery(result);
      } catch {
        /* no discovery */
      }
      setDiscoveryLoaded(true);
    })();
  }, []);

  // OAuth callback handling
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    const slackOauth = params.get("slack_oauth");
    if (!oauth && !slackOauth) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauth === "success") {
      toast.show("Google account connected", "ok");
      void reloadCapabilities().then(() => loadCaps());
    } else if (slackOauth === "success") {
      toast.show("Slack account connected", "ok");
      void reloadCapabilities().then(() => loadCaps());
    } else if (oauth === "denied" || slackOauth === "denied") {
      toast.show("OAuth consent was denied", "err");
    } else if (oauth === "no_refresh_token") {
      toast.show(
        "Google did not return a refresh token — revoke access at myaccount.google.com/permissions and try again",
        "err",
      );
    } else if (oauth === "expired" || oauth === "mismatch" || slackOauth === "expired" || slackOauth === "mismatch") {
      toast.show("OAuth session expired — try again", "err");
    } else if (oauth === "error" || slackOauth === "error") {
      toast.show("OAuth failed — check server logs", "err");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRerunDiscovery = () => {
    setRerunning(true);
    setRerunProgress(null);
    abortRef.current = startDiscovery(
      (p) => setRerunProgress(p),
      (r) => {
        setDiscovery(r);
        setRerunning(false);
        setRerunProgress(null);
        toast.show("Discovery updated", "ok");
      },
      (err) => {
        setRerunning(false);
        setRerunProgress(null);
        toast.show(`Discovery failed: ${err.message}`, "err");
      },
    );
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  // A simple list, active first. MCP is excluded — it has its own row below.
  const orderedCaps = [...caps].filter((c) => c.id !== "mcp").sort((a, b) => Number(b.enabled) - Number(a.enabled));

  return (
    <div>
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />

      <TabPanel active={tab} id="tools">
        {!loaded ? (
          <p className="empty">loading…</p>
        ) : loadError ? (
          <div
            className="cap-req"
            style={{ borderColor: "var(--err-border)", background: "var(--err-bg)", maxWidth: 480 }}
          >
            <div className="cap-req__t">
              <b style={{ color: "var(--err)" }}>Couldn't load capabilities</b>
              <small>A load failure, not an empty list.</small>
            </div>
            <button type="button" className="btn" onClick={() => void loadCaps()}>
              Retry
            </button>
          </div>
        ) : (
          <div className="cap-list">
            {orderedCaps.map((cap) => (
              <CapabilityRow key={cap.id} cap={cap} userId={userId} onChanged={() => void loadCaps()} />
            ))}
            {mcpLoaded && <McpRow servers={mcpServers} onChanged={() => void loadMcp()} />}
          </div>
        )}
      </TabPanel>

      <TabPanel active={tab} id="preferences">
        <PreferencesPanel
          discovery={discovery}
          discoveryLoaded={discoveryLoaded}
          rerunning={rerunning}
          rerunProgress={rerunProgress}
          onRerunDiscovery={onRerunDiscovery}
        />
      </TabPanel>

      <TabPanel active={tab} id="memory">
        <MemoryPanel />
      </TabPanel>
    </div>
  );
}

function McpRow({ servers, onChanged }: { servers: McpServer[]; onChanged: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const meta = CAP_META.mcp;
  return (
    <div className={`cap-row ${open ? "is-open" : ""}`}>
      <div className="cap-row__head">
        <button type="button" className="cap-row__main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="cap-row__ic">{meta.icon}</span>
          <span className="cap-row__m">
            <b>{meta.name}</b>
            <small>
              {servers.length} server{servers.length === 1 ? "" : "s"}
            </small>
          </span>
        </button>
        <button
          type="button"
          className="cap-row__chev"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
        >
          ›
        </button>
      </div>
      {open && (
        <div className="cap-row__body">
          <McpServersDetail servers={servers} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function PreferencesPanel({
  discovery,
  discoveryLoaded,
  rerunning,
  rerunProgress,
  onRerunDiscovery,
}: {
  discovery: DiscoveryResult | null;
  discoveryLoaded: boolean;
  rerunning: boolean;
  rerunProgress: DiscoveryProgress | null;
  onRerunDiscovery: () => void;
}): JSX.Element {
  if (!discoveryLoaded) return <p className="empty">loading…</p>;

  if (!discovery) {
    return (
      <div style={{ marginTop: 8 }}>
        <p className="section-hint">Tino hasn't built your profile yet.</p>
        <button type="button" className="btn btn-setup" onClick={onRerunDiscovery} disabled={rerunning}>
          {rerunning ? "Analyzing…" : "Build profile"}
        </button>
      </div>
    );
  }

  if (rerunning && rerunProgress) {
    return (
      <div className="scan-progress" style={{ marginTop: 8 }}>
        <div className="scan-progress-bar" style={{ maxWidth: 400 }}>
          <div className="scan-progress-fill" style={{ width: `${rerunProgress.pct}%` }} />
        </div>
        <span className="scan-progress-label">{rerunProgress.message}</span>
      </div>
    );
  }

  const responsibilities = [...(discovery.responsibilities ?? [])].sort(
    (a, b) => TIME_HORIZON_ORDER.indexOf(a.timeHorizon) - TIME_HORIZON_ORDER.indexOf(b.timeHorizon),
  );
  const timeInvestment = discovery.workPatterns?.timeInvestment ?? [];

  return (
    <div>
      {/* Header: who tino thinks you are, in one line. */}
      <div className="profile-head">
        <div className="p-title">
          <span className="p-role">{discovery.inferredTitle || "Your role"}</span>
          {discovery.inferredDepartment && <span className="p-dept">· {discovery.inferredDepartment}</span>}
          <button
            type="button"
            className="btn-ghost"
            style={{ marginLeft: "auto", fontSize: "var(--t-xs)", padding: 0, color: "var(--accent)" }}
            onClick={onRerunDiscovery}
            disabled={rerunning}
          >
            {rerunning ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
        {discovery.roleSummary && <p className="p-summary">{discovery.roleSummary}</p>}
      </div>

      <div className="profile-grid">
        {responsibilities.length > 0 && (
          <div className="profile-card">
            <h4>Responsibilities</h4>
            {responsibilities.slice(0, 6).map((r) => (
              <div className="p-item" key={r.title}>
                <b>{r.title}</b>
                <span className="p-tag">{r.timeHorizon}</span>
              </div>
            ))}
          </div>
        )}

        {(discovery.orgRelationships?.length ?? 0) > 0 && (
          <div className="profile-card">
            <h4>Key relationships</h4>
            {(discovery.orgRelationships ?? []).slice(0, 6).map((r) => (
              <div className="p-item" key={r.name}>
                <b>{r.name}</b>
                <span className="p-tag">{RELATIONSHIP_LABELS[r.relationship] ?? r.relationship}</span>
              </div>
            ))}
          </div>
        )}

        {(discovery.workPatterns?.meetingLoad || timeInvestment.length > 0) && (
          <div className="profile-card">
            <h4>Work patterns</h4>
            {discovery.workPatterns?.meetingLoad && (
              <div className="p-item">
                <b>Meeting load</b>
                <span className="p-ctx">{discovery.workPatterns.meetingLoad}</span>
              </div>
            )}
            {timeInvestment.slice(0, 4).map((t) => (
              <div className="p-meter" key={t.category}>
                <span className="p-cat">{t.category}</span>
                <span className="p-bar">
                  <span style={{ width: `${Math.min(100, t.estimatedPct)}%` }} />
                </span>
                <span className="p-pct">{t.estimatedPct}%</span>
              </div>
            ))}
          </div>
        )}

        {(discovery.suggestions?.length ?? 0) > 0 && (
          <div className="profile-card">
            <h4>Suggestions</h4>
            {(discovery.suggestions ?? []).slice(0, 4).map((s) => (
              <div className="p-item" key={s.title} style={{ display: "block" }}>
                <b style={{ display: "block" }}>{s.title}</b>
                <span className="p-ctx">{s.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryPanel(): JSX.Element {
  const [prefs, setPrefs] = useState<Array<{ key: string; value: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setPrefs(await getUserPreferences());
      } catch {
        /* ignore */
      }
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return <p className="empty">loading…</p>;

  if (prefs.length === 0) {
    return (
      <div style={{ marginTop: 8 }}>
        <p className="section-hint">Nothing yet. Tell tino things in Slack and it remembers them here.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="section-hint" style={{ marginTop: 0 }}>
        Set in Slack — ask tino to remember or forget something.
      </p>
      <table style={{ width: "100%", maxWidth: 600, borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
            <th
              style={{
                padding: "8px 12px",
                color: "var(--text-dim)",
                fontWeight: 500,
                fontSize: "0.786rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              key
            </th>
            <th
              style={{
                padding: "8px 12px",
                color: "var(--text-dim)",
                fontWeight: 500,
                fontSize: "0.786rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              value
            </th>
          </tr>
        </thead>
        <tbody>
          {prefs.map((p) => (
            <tr key={p.key} style={{ borderBottom: "1px solid var(--border-sub)" }}>
              <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.857rem" }}>
                {p.key}
              </td>
              <td style={{ padding: "8px 12px" }}>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
