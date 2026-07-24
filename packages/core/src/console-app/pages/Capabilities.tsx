import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CapabilityDetail } from "../components/CapabilityDetail.js";
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

type Selected = { kind: "cap"; id: string } | { kind: "mcp" } | null;

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
  { id: "tools", label: "Tools" },
  { id: "preferences", label: "Preferences" },
  { id: "memory", label: "Memory" },
];

export function Capabilities(): JSX.Element {
  const { session } = useOutletContext<{ session: Session; health: HealthResponse | null }>();
  const toast = useToast();
  const userId = session.user.id;

  const [tab, setTab] = useState("tools");
  const [caps, setCaps] = useState<CapabilityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Selected>(null);

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

  // Active capabilities first, then available — one grid, no separate sections.
  const orderedCaps = [...caps].sort((a, b) => Number(b.enabled) - Number(a.enabled));
  const selectedCap = selected?.kind === "cap" ? caps.find((c) => c.id === selected.id) : undefined;

  return (
    <div>
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />

      <TabPanel active={tab} id="tools">
        <h2 className="section-label" style={{ marginTop: 0 }}>
          Capabilities
        </h2>
        <p className="section-hint">
          Each card is one thing tino can do. Select one to configure it and see the tools it grants.
        </p>

        {!loaded ? (
          <p className="empty">loading capabilities…</p>
        ) : loadError ? (
          <div
            className="cap-req"
            style={{ borderColor: "var(--err-border)", background: "var(--err-bg)", maxWidth: 480 }}
          >
            <div className="cap-req__t">
              <b style={{ color: "var(--err)" }}>Couldn't load capabilities</b>
              <small>This is a load failure, not an empty list. Check the server and retry.</small>
            </div>
            <button type="button" className="btn" onClick={() => void loadCaps()}>
              Retry
            </button>
          </div>
        ) : (
          <div className={`md ${selected ? "is-split" : ""}`}>
            <div className="md__master">
              {orderedCaps.map((cap) => {
                const meta = CAP_META[cap.id] ?? { icon: "⚙️", name: cap.displayName ?? cap.id, desc: "" };
                const isSel = selected?.kind === "cap" && selected.id === cap.id;
                return (
                  <button
                    key={cap.id}
                    type="button"
                    className={`md-card ${isSel ? "is-selected" : ""}`}
                    onClick={() => setSelected({ kind: "cap", id: cap.id })}
                  >
                    <div className="md-card__ic">{meta.icon}</div>
                    <div className="md-card__body">
                      <div className="md-card__name">{meta.name}</div>
                      <div className="md-card__desc">{meta.desc}</div>
                      <div className="md-card__foot">
                        <span className={`cap-badge ${cap.enabled ? "is-active" : "is-avail"}`}>
                          <span className="cap-badge__d" />
                          {cap.enabled ? "Active" : "Available"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
              {mcpLoaded && (
                <button
                  type="button"
                  className={`md-card ${selected?.kind === "mcp" ? "is-selected" : ""}`}
                  onClick={() => setSelected({ kind: "mcp" })}
                >
                  <div className="md-card__ic">◆</div>
                  <div className="md-card__body">
                    <div className="md-card__name">MCP Tools</div>
                    <div className="md-card__desc">Bring your own tool servers — remote or local.</div>
                    <div className="md-card__foot">
                      <span className="cap-badge is-active">
                        <span className="cap-badge__d" />
                        {mcpServers.length} server{mcpServers.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                </button>
              )}
            </div>

            <div className="md__detail">
              {selectedCap && (
                <CapabilityDetail
                  key={selectedCap.id}
                  cap={selectedCap}
                  userId={userId}
                  onChanged={() => void loadCaps()}
                  onClose={() => setSelected(null)}
                />
              )}
              {selected?.kind === "mcp" && (
                <McpServersDetail
                  servers={mcpServers}
                  onChanged={() => void loadMcp()}
                  onClose={() => setSelected(null)}
                />
              )}
            </div>
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
        <p className="section-hint">
          tino hasn't analyzed your work patterns yet. run discovery to build your profile.
        </p>
        <button type="button" className="btn btn-setup" onClick={onRerunDiscovery} disabled={rerunning}>
          {rerunning ? "running…" : "run discovery"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 className="section-label" style={{ marginTop: 0 }}>
          Your role
        </h2>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: "0.714rem", padding: 0 }}
          onClick={onRerunDiscovery}
          disabled={rerunning}
        >
          {rerunning ? "running…" : "re-run discovery"}
        </button>
      </div>
      {rerunning && rerunProgress ? (
        <div className="scan-progress" style={{ marginTop: 8 }}>
          <div className="scan-progress-bar" style={{ maxWidth: 400 }}>
            <div className="scan-progress-fill" style={{ width: `${rerunProgress.pct}%` }} />
          </div>
          <span className="scan-progress-label">{rerunProgress.message}</span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {discovery.inferredTitle && (
              <span
                style={{
                  fontSize: "0.786rem",
                  fontWeight: 600,
                  color: "var(--accent)",
                  background: "var(--accent-dim, rgba(99,102,241,0.1))",
                  borderRadius: 4,
                  padding: "2px 6px",
                }}
              >
                {discovery.inferredTitle}
              </span>
            )}
            {discovery.inferredDepartment && (
              <span
                style={{
                  fontSize: "0.786rem",
                  color: "var(--text-dim)",
                  background: "var(--surface-2, rgba(0,0,0,0.05))",
                  borderRadius: 4,
                  padding: "2px 6px",
                }}
              >
                {discovery.inferredDepartment}
              </span>
            )}
          </div>
          <p style={{ fontSize: "0.857rem", color: "var(--text-sub)", marginTop: 4 }}>{discovery.roleSummary}</p>

          {(discovery.orgRelationships?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.786rem", fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 }}>
                org relationships
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.857rem", color: "var(--text-sub)" }}>
                {(discovery.orgRelationships ?? []).map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <strong>{r.name}</strong>
                    <span style={{ color: "var(--text-dim)", marginLeft: 6, fontSize: "0.786rem" }}>
                      {RELATIONSHIP_LABELS[r.relationship] ?? r.relationship}
                    </span>
                    {r.interactionFrequency && (
                      <span style={{ color: "var(--text-dim)", marginLeft: 4, fontSize: "0.786rem" }}>
                        · {r.interactionFrequency}
                      </span>
                    )}
                    {r.context && <span style={{ color: "var(--text-sub)" }}> — {r.context}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(discovery.responsibilities?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.786rem", fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 }}>
                responsibilities
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.857rem", color: "var(--text-sub)" }}>
                {[...(discovery.responsibilities ?? [])]
                  .sort((a, b) => TIME_HORIZON_ORDER.indexOf(a.timeHorizon) - TIME_HORIZON_ORDER.indexOf(b.timeHorizon))
                  .map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <strong>{r.title}</strong>
                      <span style={{ color: "var(--text-dim)", marginLeft: 6, fontSize: "0.786rem" }}>
                        {r.timeHorizon}
                      </span>
                      {r.description && <span> — {r.description}</span>}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {(discovery.workPatterns?.meetingLoad || (discovery.workPatterns?.recurringCommitments?.length ?? 0) > 0) && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.786rem", fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 }}>
                work patterns
              </div>
              <div style={{ fontSize: "0.857rem", color: "var(--text-sub)" }}>
                {discovery.workPatterns?.meetingLoad && (
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.786rem" }}>meeting load</span>{" "}
                    {discovery.workPatterns.meetingLoad}
                  </div>
                )}
                {(discovery.workPatterns?.timeInvestment?.length ?? 0) > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    {(discovery.workPatterns?.timeInvestment ?? []).map((t, i) => (
                      <span key={i} style={{ marginRight: 8 }}>
                        <span style={{ color: "var(--text-dim)", fontSize: "0.786rem" }}>{t.category}</span>{" "}
                        {t.estimatedPct}%
                      </span>
                    ))}
                  </div>
                )}
                {(discovery.workPatterns?.recurringCommitments?.length ?? 0) > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(discovery.workPatterns?.recurringCommitments ?? []).map((c, i) => (
                      <li key={i} style={{ marginBottom: 2 }}>
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {(discovery.painPoints?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.786rem", fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 }}>
                pain points
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.857rem", color: "var(--text-sub)" }}>
                {(discovery.painPoints ?? []).map((p, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(discovery.suggestions?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.786rem", fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 }}>
                suggestions
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.857rem", color: "var(--text-sub)" }}>
                {(discovery.suggestions ?? []).map((s, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <strong>{s.title}</strong> — {s.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
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
        <p className="section-hint">
          tino hasn't saved any preferences yet. tell tino things like "i'm in pacific timezone" or "i prefer concise
          summaries" and it will remember.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-label" style={{ marginTop: 0 }}>
        Stored preferences
      </h2>
      <p className="section-hint">
        these are things tino remembers about you. set via Slack — tell tino to remember or forget something.
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
