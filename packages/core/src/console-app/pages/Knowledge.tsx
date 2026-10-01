import { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { DontLearnFrom } from "../components/DontLearnFrom.js";
import {
  browseKb,
  getKbActivity,
  getKbStatus,
  getKbTopics,
  getKnowledge,
  getTopicChunks,
  type KbActivityEvent,
  type KbFact,
  type KbFactKind,
  type KbItem,
  type KbScope,
  type KbStatus,
  type KbTopic,
} from "../lib/api.js";

/**
 * Knowledge — what Tino has concluded, what it is still reading, and what the
 * indexer is doing right now.
 *
 * Four views, in decreasing order of how digested the content is:
 *   knowledge  distilled claims, grouped by what they are about
 *   themes     clusters of related conversations, labelled
 *   sources    the raw indexed excerpts the other two are built from
 *   activity   per-cycle, per-source log of the indexer itself
 */

type Mode = "knowledge" | "themes" | "sources" | "activity";

const MODES: Array<{ id: Mode; label: string; blurb: string }> = [
  { id: "knowledge", label: "knowledge", blurb: "Claims tino has drawn from your history, with the messages that back them." },
  { id: "themes", label: "themes", blurb: "Conversations grouped by what they are about." },
  { id: "sources", label: "sources", blurb: "The raw excerpts everything above is built from." },
  { id: "activity", label: "activity", blurb: "What each indexer cycle did, source by source." },
];

const KIND_ORDER: KbFactKind[] = ["project", "problem", "commitment", "decision", "person", "preference", "fact"];

const KIND_LABEL: Record<string, string> = {
  project: "project",
  problem: "problem",
  commitment: "commitment",
  decision: "decision",
  person: "person",
  preference: "preference",
  fact: "fact",
};

const SOURCE_LABEL: Record<string, string> = {
  slack_channel: "slack channel",
  slack_thread: "slack thread",
  slack_dm: "slack dm",
  gmail: "gmail",
  synthesis: "distilling",
  topics: "themes",
  slack: "slack",
};

const fmtWhen = (iso: string | number | undefined): string => {
  if (iso === undefined || iso === null) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  if (mins < 1440) return Math.round(mins / 60) + "h ago";
  return Math.round(mins / 1440) + "d ago";
};

const fmtDate = (iso: string | number | null | undefined): string =>
  iso === undefined || iso === null
    ? "—"
    : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const fmtRange = (from: string | number | null | undefined, to: string | number | null | undefined): string =>
  from && to ? fmtDate(from) + " → " + fmtDate(to) : "—";

// ── Facts ─────────────────────────────────────────────────────────────────────

function FactCard({ fact }: { fact: KbFact }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="kb-fact">
      <div className="kb-fact-head">
        <span className={"kb-kind kb-kind-" + fact.kind}>{KIND_LABEL[fact.kind] ?? fact.kind}</span>
        <p className="kb-fact-claim">{fact.statement}</p>
      </div>
      {fact.detail ? <p className="kb-fact-detail">{fact.detail}</p> : null}
      <div className="kb-fact-foot">
        <span className="kb-meta-dim">
          {fact.firstSeen.slice(0, 10) === fact.lastSeen.slice(0, 10)
            ? fmtDate(fact.lastSeen)
            : fmtRange(fact.firstSeen, fact.lastSeen)}
        </span>
        {fact.evidence.length > 0 ? (
          <button type="button" className="kb-evidence-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? "hide" : "show"} {fact.evidence.length} source{fact.evidence.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="kb-evidence">
          {fact.evidence.map((e, i) => (
            <li key={e.permalink ?? String(i)} className="kb-evidence-item">
              <div className="kb-evidence-head">
                <span className="kb-badge kb-badge-src">{SOURCE_LABEL[e.source] ?? e.source}</span>
                <span className="kb-meta-dim">{fmtDate(e.ts)}</span>
                {e.permalink ? (
                  <a className="kb-link" href={e.permalink} target="_blank" rel="noopener noreferrer">
                    open ↗
                  </a>
                ) : null}
              </div>
              <p className="kb-evidence-text">{e.snippet}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function KnowledgeView({
  facts,
  kinds,
  kind,
  setKind,
  loading,
  empty,
}: {
  facts: KbFact[];
  kinds: Array<{ kind: KbFactKind; count: number }>;
  kind: string;
  setKind: (k: string) => void;
  loading: boolean;
  empty: JSX.Element;
}): JSX.Element {
  // Group by subject so related claims read as one thing tino knows about,
  // rather than a flat wall of sentences.
  const groups = useMemo(() => {
    const bySubject = new Map<string, KbFact[]>();
    for (const f of facts) bySubject.set(f.subject, [...(bySubject.get(f.subject) ?? []), f]);
    return [...bySubject.entries()]
      .map(([subject, items]) => ({
        subject,
        items: [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
        newest: Math.max(...items.map((i) => Date.parse(i.lastSeen))),
      }))
      .sort((a, b) => b.newest - a.newest);
  }, [facts]);

  const ordered = [...kinds].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  return (
    <>
      {ordered.length > 0 ? (
        <div className="kb-chips">
          <button type="button" className={"kb-chip" + (kind === "" ? " active" : "")} onClick={() => setKind("")}>
            everything
          </button>
          {ordered.map((k) => (
            <button
              key={k.kind}
              type="button"
              className={"kb-chip" + (kind === k.kind ? " active" : "")}
              onClick={() => setKind(kind === k.kind ? "" : k.kind)}
            >
              {KIND_LABEL[k.kind] ?? k.kind} <span className="kb-chip-n">{k.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <p className="kb-sub">loading…</p> : groups.length === 0 ? empty : null}

      {groups.map((g) => (
        <section key={g.subject} className="kb-subject">
          <h3 className="kb-subject-title">
            {g.subject}
            <span className="kb-subject-n">
              {g.items.length} {g.items.length === 1 ? "fact" : "facts"}
            </span>
          </h3>
          <ul className="kb-fact-list">
            {g.items.map((f) => (
              <FactCard key={f.id} fact={f} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// ── Themes ────────────────────────────────────────────────────────────────────

function ThemesView({ scope, topics, loading }: { scope: KbScope; topics: KbTopic[]; loading: boolean }): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<KbItem[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = async (id: string): Promise<void> => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setBusy(true);
    try {
      const res = await getTopicChunks(scope, id);
      setChunks(res.items);
    } catch {
      setChunks([]);
    } finally {
      setBusy(false);
    }
  };

  const max = Math.max(1, ...topics.map((t) => t.chunks));

  if (loading) return <p className="kb-sub">loading…</p>;
  if (topics.length === 0) {
    return (
      <p className="kb-sub">
        no themes yet. tino clusters this scope every few hours once there are at least a few dozen indexed
        excerpts.
      </p>
    );
  }

  return (
    <ul className="kb-topic-list">
      {topics.map((t) => (
        <li key={t.id} className="kb-topic">
          <button type="button" className="kb-topic-row" onClick={() => void toggle(t.id)}>
            <span className="kb-topic-bar" style={{ width: Math.round((t.chunks / max) * 100) + "%" }} />
            <span className="kb-topic-label">{t.label}</span>
            <span className="kb-topic-n">{t.chunks}</span>
          </button>
          <p className="kb-topic-summary">{t.summary}</p>
          <p className="kb-meta-dim kb-topic-range">{fmtRange(t.oldest, t.newest)}</p>
          {openId === t.id ? (
            busy ? (
              <p className="kb-sub">loading…</p>
            ) : (
              <ChunkList items={chunks} />
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ── Sources ───────────────────────────────────────────────────────────────────

function ChunkList({ items }: { items: KbItem[] }): JSX.Element {
  if (items.length === 0) return <p className="kb-sub">nothing here.</p>;
  return (
    <ul className="kb-list">
      {items.map((it, i) => (
        <li key={it.id ?? it.ts + String(i)} className="kb-item">
          <div className="kb-item-head">
            <span className="kb-badge kb-badge-src">{SOURCE_LABEL[it.source] ?? it.source}</span>
            {typeof it.meta.channelName === "string" && it.meta.channelName ? (
              <span className="kb-meta">#{it.meta.channelName}</span>
            ) : null}
            {typeof it.meta.subject === "string" && it.meta.subject ? (
              <span className="kb-meta">{it.meta.subject}</span>
            ) : null}
            <span className="kb-meta kb-meta-dim">{fmtDate(it.ts)}</span>
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
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────

function ActivityView({ events, loading }: { events: KbActivityEvent[]; loading: boolean }): JSX.Element {
  const cycles = useMemo(() => {
    const byCycle = new Map<string, KbActivityEvent[]>();
    for (const e of events) byCycle.set(e.cycleId, [...(byCycle.get(e.cycleId) ?? []), e]);
    return [...byCycle.entries()]
      .map(([cycleId, rows]) => ({
        cycleId,
        at: Math.max(...rows.map((r) => Date.parse(r.at))),
        rows: [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      }))
      .sort((a, b) => b.at - a.at);
  }, [events]);

  if (loading) return <p className="kb-sub">loading…</p>;
  if (cycles.length === 0) {
    return <p className="kb-sub">no cycles recorded yet — the first one runs shortly after startup.</p>;
  }

  return (
    <ul className="kb-cycles">
      {cycles.map((c) => {
        const chunks = c.rows.reduce((n, r) => n + r.chunksUpserted, 0);
        const calls = c.rows.reduce((n, r) => n + r.apiCalls, 0);
        return (
          <li key={c.cycleId} className="kb-cycle">
            <div className="kb-cycle-head">
              <span className="kb-cycle-time">{fmtWhen(c.at)}</span>
              <span className="kb-meta-dim">
                {chunks} chunk{chunks === 1 ? "" : "s"} · {calls} call{calls === 1 ? "" : "s"}
              </span>
            </div>
            <table className="kb-table kb-cycle-table">
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="kb-cycle-src">
                      <span className={"kb-badge kb-badge-" + r.outcome}>{SOURCE_LABEL[r.source] ?? r.source}</span>
                    </td>
                    <td className="kb-cycle-scope">{r.scope}</td>
                    <td className="kb-cycle-detail">
                      {r.error ? <span className="kb-err">{r.error}</span> : (r.detail ?? "—")}
                    </td>
                    <td className="kb-cycle-ms">{r.ms > 0 ? (r.ms / 1000).toFixed(1) + "s" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </li>
        );
      })}
    </ul>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Knowledge({ onBack }: { onBack: () => void }): JSX.Element {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [scope, setScope] = useState<KbScope>("private");
  const [mode, setMode] = useState<Mode>("knowledge");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [facts, setFacts] = useState<KbFact[]>([]);
  const [kinds, setKinds] = useState<Array<{ kind: KbFactKind; count: number }>>([]);
  const [kind, setKind] = useState("");

  const [topics, setTopics] = useState<KbTopic[]>([]);

  const [items, setItems] = useState<KbItem[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const [events, setEvents] = useState<KbActivityEvent[]>([]);

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
      if (mode === "knowledge") {
        const res = await getKnowledge({ scope, kind: kind || undefined, limit: 200 });
        setFacts(res.items);
        setKinds(res.kinds);
      } else if (mode === "themes") {
        setTopics((await getKbTopics(scope)).items);
      } else if (mode === "sources") {
        const res = await browseKb({ scope, q: submitted || undefined, source: source || undefined, limit: 25 });
        setItems(res.items);
        setTotal(res.total);
      } else {
        setEvents((await getKbActivity(80)).items);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mode, scope, kind, submitted, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const ix = status?.indexer;
  const stats = status?.scopes?.[scope];
  const scopeWord = scope === "private" ? "you" : "your workspace";

  // The empty state has to explain itself: an empty knowledge list usually
  // means "still working", not "nothing to know".
  const knowledgeEmpty = (
    <div className="kb-empty">
      <p className="kb-empty-title">nothing distilled about {scopeWord} yet</p>
      {status?.distilling === false ? (
        <p className="kb-sub">
          no model is configured, so tino can index but cannot draw conclusions. set a provider in Setup.
        </p>
      ) : stats && stats.pending > 0 ? (
        <p className="kb-sub">
          {stats.pending.toLocaleString()} indexed excerpt{stats.pending === 1 ? "" : "s"} are queued. tino distills a
          batch every cycle, so this fills in over the next few hours.
        </p>
      ) : stats && stats.chunks === 0 ? (
        <p className="kb-sub">
          nothing is indexed in this scope yet.{" "}
          {scope === "private"
            ? 'DM tino "connect" in Slack to link your account.'
            : "workspace coverage comes from the public channels connected users belong to."}
        </p>
      ) : (
        <p className="kb-sub">the next cycle will pick this up.</p>
      )}
    </div>
  );

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
        {/* ── Scope + coverage ───────────────────────────────────────────── */}
        <section className="kb-card">
          <div className="kb-card-head">
            <div className="kb-tabs">
              <button
                type="button"
                className={"kb-tab" + (scope === "private" ? " active" : "")}
                onClick={() => setScope("private")}
              >
                private
              </button>
              <button
                type="button"
                className={"kb-tab" + (scope === "workspace" ? " active" : "")}
                onClick={() => setScope("workspace")}
              >
                workspace
              </button>
            </div>
            <span className={"kb-dot " + (ix?.running ? "kb-dot-live" : "kb-dot-idle")}>
              {ix?.running ? "indexing now" : status?.enabled ? "idle" : "disabled"}
            </span>
          </div>

          <p className="kb-scope-blurb">
            {scope === "private"
              ? "Your own DMs, private channels, and email. Only you can see this."
              : "Public Slack channels, shared across everyone who uses tino."}
          </p>

          {status?.enabled ? (
            <div className="kb-stat-row">
              <div className="kb-stat">
                <span className="kb-stat-n">{(stats?.facts ?? 0).toLocaleString()}</span>
                <span className="kb-stat-l">facts known</span>
              </div>
              <div className="kb-stat">
                <span className="kb-stat-n">{(stats?.chunks ?? 0).toLocaleString()}</span>
                <span className="kb-stat-l">excerpts indexed</span>
              </div>
              <div className="kb-stat">
                <span className="kb-stat-n">{(stats?.pending ?? 0).toLocaleString()}</span>
                <span className="kb-stat-l">queued to distill</span>
              </div>
              <div className="kb-stat">
                <span className="kb-stat-n kb-stat-sm">{fmtRange(stats?.oldestMs, stats?.newestMs)}</span>
                <span className="kb-stat-l">covering</span>
              </div>
            </div>
          ) : (
            <p className="kb-sub">
              the knowledge base is off — it needs Postgres + pgvector and Vertex embedding credentials.
            </p>
          )}

          <p className="kb-sub kb-cycle-line">
            last cycle {fmtWhen(ix?.lastCycle?.at)}
            {ix?.lastCycle ? " · " + (ix.lastCycle.ms / 1000).toFixed(1) + "s" : ""}
            {ix ? " · every " + Math.round(ix.intervalMs / 60000) + "m" : ""}
            {ix?.lastCycle && ix.lastCycle.errors > 0 ? (
              <span className="kb-err"> · {ix.lastCycle.errors} error(s)</span>
            ) : null}
          </p>
        </section>

        {scope === "private" ? <DontLearnFrom /> : null}

        {/* ── Views ──────────────────────────────────────────────────────── */}
        <section className="kb-card">
          <div className="kb-modebar">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={"kb-mode" + (mode === m.id ? " active" : "")}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="kb-sub kb-mode-blurb">{MODES.find((m) => m.id === mode)?.blurb}</p>

          {err ? <p className="kb-err">{err}</p> : null}

          {mode === "knowledge" ? (
            <KnowledgeView
              facts={facts}
              kinds={kinds}
              kind={kind}
              setKind={setKind}
              loading={loading}
              empty={knowledgeEmpty}
            />
          ) : null}

          {mode === "themes" ? <ThemesView scope={scope} topics={topics} loading={loading} /> : null}

          {mode === "sources" ? (
            <>
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
              {loading ? (
                <p className="kb-sub">loading…</p>
              ) : (
                <>
                  <p className="kb-sub">
                    {submitted
                      ? items.length + " best matches"
                      : "newest " + items.length + " of " + total.toLocaleString()}
                  </p>
                  <ChunkList items={items} />
                </>
              )}
            </>
          ) : null}

          {mode === "activity" ? <ActivityView events={events} loading={loading} /> : null}
        </section>

        {/* ── Connections ────────────────────────────────────────────────── */}
        <section className="kb-card">
          <h2 className="kb-h2">connections</h2>
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
              {(status?.principals ?? []).map((p) => (
                <tr key={p.scope + ":" + p.userId + ":" + p.source}>
                  <td>{SOURCE_LABEL[p.source] ?? p.source}</td>
                  <td>{p.scope}</td>
                  <td>
                    <span className={"kb-badge kb-badge-" + p.status}>{p.status.replace("_", " ")}</span>
                    {p.lastError ? (
                      <div className="kb-err" title={p.lastError}>
                        {p.lastError.slice(0, 90)}…
                      </div>
                    ) : null}
                  </td>
                  <td>{p.backfillDone ? "complete" : "in progress"}</td>
                  <td>{fmtWhen(p.lastCycleAt)}</td>
                </tr>
              ))}
              {(status?.principals ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="kb-empty-row">
                    nothing connected yet — DM tino "connect" in Slack, or connect Google from the chat header.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
