import { type JSX, useCallback, useEffect, useState } from "react";
import { browseKb, getKbStatus, type KbItem, type KbStatus } from "../lib/api.js";

/**
 * Knowledge — what Tino has indexed and what the indexer is doing right now.
 * Two scopes: the shared workspace KB and your private one. Empty search box
 * = newest-first listing; typing a query runs the same semantic + recency
 * ranked search the agent uses.
 */

const SOURCE_LABEL: Record<string, string> = {
  slack_channel: "slack channel",
  slack_thread: "slack thread",
  slack_dm: "slack dm",
  gmail: "gmail",
};

const fmtWhen = (iso: string | number | undefined): string => {
  if (iso === undefined) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const fmtDate = (iso: string | number | undefined): string =>
  iso === undefined ? "—" : new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Knowledge({ onBack }: { onBack: () => void }): JSX.Element {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [scope, setScope] = useState<"workspace" | "mine">("mine");
  const [source, setSource] = useState<string>("");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [items, setItems] = useState<KbItem[]>([]);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState<"recent" | "search">("recent");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Status polls every 10s so a running cycle is visible live.
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const s = await getKbStatus();
        if (alive) setStatus(s);
      } catch {
        /* transient */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErr("");
    try {
      const res = await browseKb({ scope, q: submitted || undefined, source: source || undefined, limit: 25 });
      setItems(res.items);
      setTotal(res.total);
      setMode(res.mode);
    } catch (e) {
      setErr((e as Error).message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [scope, submitted, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const ix = status?.indexer;
  const scopeStats = status?.scopes?.[scope];

  return (
    <div className="kb-root">
      <header className="chat-header">
        <div className="logo-block">
          <img src="/assets/tino-logo.png" alt="tino" className="chat-logo" />
          <span className="logo-wordmark">tino</span>
          <span className="kb-title">knowledge</span>
        </div>
        <div className="chat-header-actions">
          <button className="btn-ghost" type="button" onClick={onBack}>
            ← back to chat
          </button>
        </div>
      </header>

      <div className="kb-body">
        {/* ── Indexer status ─────────────────────────────────────────── */}
        <section className="kb-card">
          <div className="kb-card-head">
            <h2 className="kb-h2">indexer</h2>
            <span className={`kb-dot ${ix?.running ? "kb-dot-live" : "kb-dot-idle"}`}>
              {ix?.running ? "running now" : status?.enabled ? "idle" : "disabled"}
            </span>
          </div>
          {status?.enabled ? (
            <>
              <div className="kb-stat-row">
                <div className="kb-stat">
                  <span className="kb-stat-n">{ix?.cyclesCompleted ?? 0}</span>
                  <span className="kb-stat-l">cycles</span>
                </div>
                <div className="kb-stat">
                  <span className="kb-stat-n">{ix?.lastCycle?.chunksUpserted ?? 0}</span>
                  <span className="kb-stat-l">chunks last cycle</span>
                </div>
                <div className="kb-stat">
                  <span className="kb-stat-n">{ix?.lastCycle?.apiCalls ?? 0}</span>
                  <span className="kb-stat-l">api calls</span>
                </div>
                <div className="kb-stat">
                  <span className={`kb-stat-n${(ix?.lastCycle?.errors ?? 0) > 0 ? " kb-bad" : ""}`}>
                    {ix?.lastCycle?.errors ?? 0}
                  </span>
                  <span className="kb-stat-l">errors</span>
                </div>
              </div>
              <p className="kb-sub">
                last run {fmtWhen(ix?.lastCycle?.at)}
                {ix?.lastCycle ? ` · took ${(ix.lastCycle.ms / 1000).toFixed(1)}s` : ""}
                {ix?.nextRunAt && !ix.running ? ` · next ${fmtWhen(ix.nextRunAt)}`.replace(" ago", "") : ""}
                {ix ? ` · every ${Math.round(ix.intervalMs / 60000)}m` : ""}
              </p>

              <table className="kb-table">
                <thead>
                  <tr>
                    <th>source</th>
                    <th>scope</th>
                    <th>status</th>
                    <th>backfill</th>
                    <th>last run</th>
                  </tr>
                </thead>
                <tbody>
                  {(status.principals ?? []).map((p) => (
                    <tr key={`${p.scope}:${p.userId}:${p.source}`}>
                      <td>{p.source}</td>
                      <td>{p.scope === "workspace" ? "workspace" : "mine"}</td>
                      <td>
                        <span className={`kb-badge kb-badge-${p.status}`}>{p.status.replace("_", " ")}</span>
                        {p.lastError ? <div className="kb-err" title={p.lastError}>{p.lastError.slice(0, 90)}…</div> : null}
                      </td>
                      <td>{p.backfillDone ? "complete" : "in progress"}</td>
                      <td>{fmtWhen(p.lastCycleAt)}</td>
                    </tr>
                  ))}
                  {(status.principals ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="kb-empty-row">
                        nothing connected yet — DM tino "connect" in Slack, or connect Google from the chat header.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </>
          ) : (
            <p className="kb-sub">
              the knowledge base is off — it needs Postgres + pgvector and Vertex embedding credentials.
            </p>
          )}
        </section>

        {/* ── Browse ─────────────────────────────────────────────────── */}
        <section className="kb-card">
          <div className="kb-card-head">
            <h2 className="kb-h2">browse</h2>
            <div className="kb-tabs">
              <button
                type="button"
                className={`kb-tab${scope === "mine" ? " active" : ""}`}
                onClick={() => setScope("mine")}
              >
                mine
              </button>
              <button
                type="button"
                className={`kb-tab${scope === "workspace" ? " active" : ""}`}
                onClick={() => setScope("workspace")}
              >
                workspace
              </button>
            </div>
          </div>

          <p className="kb-sub">
            {scopeStats ? (
              <>
                <strong>{scopeStats.chunks.toLocaleString()}</strong> chunks
                {scopeStats.oldestMs ? ` · ${fmtDate(scopeStats.oldestMs)} → ${fmtDate(scopeStats.newestMs ?? undefined)}` : ""}
                {scopeStats.bySource.length > 0
                  ? ` · ${scopeStats.bySource.map((b) => `${SOURCE_LABEL[b.source] ?? b.source} ${b.chunks}`).join(", ")}`
                  : ""}
              </>
            ) : (
              "—"
            )}
          </p>

          <form
            className="kb-search-row"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(query.trim());
            }}
          >
            <input
              className="chat-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search meaning (empty = newest first)…"
            />
            <select className="field-input kb-select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">all sources</option>
              <option value="slack_channel">slack channels</option>
              <option value="slack_thread">slack threads</option>
              <option value="slack_dm">slack dms</option>
              <option value="gmail">gmail</option>
            </select>
            <button className="btn btn-primary" type="submit">
              search
            </button>
          </form>

          {err ? <p className="kb-err">{err}</p> : null}
          {loading ? (
            <p className="kb-sub">loading…</p>
          ) : items.length === 0 ? (
            <p className="kb-sub">
              nothing indexed here yet{submitted ? " for that query" : ""}. the indexer backfills ~90 days over several
              cycles.
            </p>
          ) : (
            <>
              <p className="kb-sub">
                {mode === "search" ? `${items.length} best matches` : `newest ${items.length} of ${total.toLocaleString()}`}
              </p>
              <ul className="kb-list">
                {items.map((it, i) => (
                  <li key={it.id ?? `${it.ts}-${i}`} className="kb-item">
                    <div className="kb-item-head">
                      <span className={`kb-badge kb-badge-src`}>{SOURCE_LABEL[it.source] ?? it.source}</span>
                      {typeof it.meta.channelName === "string" && it.meta.channelName ? (
                        <span className="kb-meta">#{it.meta.channelName}</span>
                      ) : null}
                      {typeof it.meta.subject === "string" && it.meta.subject ? (
                        <span className="kb-meta">{it.meta.subject}</span>
                      ) : null}
                      <span className="kb-meta kb-meta-dim">{fmtDate(it.ts)}</span>
                      {it.score !== undefined ? <span className="kb-meta kb-meta-dim">score {it.score}</span> : null}
                      {it.permalink ? (
                        <a className="kb-meta kb-link" href={it.permalink} target="_blank" rel="noopener noreferrer">
                          open ↗
                        </a>
                      ) : null}
                    </div>
                    <pre className="kb-text">{it.text}</pre>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
