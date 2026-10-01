import type { KbActivityEvent } from "@tino/contracts";
import { useMemo } from "react";
import { sourceLabel } from "../../../components/knowledge/labels";
import { RouteError } from "../../../components/RouteError";
import { Badge, type Tone } from "../../../components/ui/Badge";
import { Section } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { orgApi } from "../../../lib/api";
import { fmtAgo, fmtDateTime, fmtDuration, plural } from "../../../lib/format";
import type { Route } from "./+types/activity";
import { useKbStatus } from "./layout";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { items } = await orgApi(params.slug).activity(80);
  return { events: items };
}

const OUTCOME: Record<KbActivityEvent["outcome"], { tone: Tone; word: string }> = {
  ok: { tone: "ok", word: "✓" },
  skipped: { tone: "neutral", word: "skipped" },
  auth_error: { tone: "warn", word: "! reconnect" },
  error: { tone: "err", word: "✕ error" },
};

const PRINCIPAL: Record<string, { tone: Tone; word: string }> = {
  active: { tone: "ok", word: "✓ active" },
  paused_auth: { tone: "warn", word: "! needs reconnect" },
  paused_error: { tone: "err", word: "✕ paused" },
  disabled: { tone: "neutral", word: "off" },
};

export default function Activity({ loaderData }: Route.ComponentProps) {
  const status = useKbStatus();
  const cycles = useMemo(() => {
    const by = new Map<string, KbActivityEvent[]>();
    for (const e of loaderData.events) by.set(e.cycleId, [...(by.get(e.cycleId) ?? []), e]);
    return [...by.entries()]
      .map(([cycleId, rows]) => ({
        cycleId,
        at: Math.max(...rows.map((r) => Date.parse(r.at) || 0)),
        rows: [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      }))
      .sort((a, b) => b.at - a.at);
  }, [loaderData.events]);
  const principals = status.principals ?? [];

  return (
    <div className="stack-lg">
      <section aria-label="indexer cycles">
        {cycles.length === 0 ? (
          <EmptyState title="no cycles yet">the first one runs shortly after the knowledge base turns on.</EmptyState>
        ) : (
          <ol className="cycles">
            {cycles.map((c) => {
              const chunks = c.rows.reduce((n, r) => n + r.chunksUpserted, 0);
              const calls = c.rows.reduce((n, r) => n + r.apiCalls, 0);
              return (
                <li key={c.cycleId} className="cycle">
                  <p className="cycle__head">
                    <strong title={fmtDateTime(c.at)}>{fmtAgo(c.at)}</strong>
                    <span className="muted small">
                      {plural(chunks, "excerpt")} · {plural(calls, "API call")}
                    </span>
                  </p>
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {c.rows.map((r) => (
                          <tr key={r.id}>
                            <td className="nowrap">{sourceLabel(r.source)}</td>
                            <td className="muted">{r.scope}</td>
                            <td>
                              <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].word}</Badge>
                            </td>
                            <td className="cycle__detail">
                              {r.error ? <span className="err-text">{r.error}</span> : (r.detail ?? "—")}
                            </td>
                            <td className="num muted">{fmtDuration(r.ms)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <Section title="sources" sub="each connected account tino reads from, and how it's doing.">
        {principals.length === 0 ? (
          <p className="muted small">nothing connected yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">source</th>
                  <th scope="col">scope</th>
                  <th scope="col">status</th>
                  <th scope="col">history</th>
                  <th scope="col">last run</th>
                </tr>
              </thead>
              <tbody>
                {principals.map((p) => (
                  <tr key={`${p.scope}:${p.userId}:${p.source}`}>
                    <td>{sourceLabel(p.source)}</td>
                    <td className="muted">{p.scope}</td>
                    <td>
                      <Badge tone={PRINCIPAL[p.status]?.tone ?? "neutral"}>
                        {PRINCIPAL[p.status]?.word ?? p.status}
                      </Badge>
                      {p.lastError ? (
                        <p className="err-text small" title={p.lastError}>
                          {p.lastError.length > 90 ? `${p.lastError.slice(0, 90)}…` : p.lastError}
                        </p>
                      ) : null}
                    </td>
                    <td>{p.backfillDone ? "caught up" : "still reading back"}</td>
                    <td className="muted">{fmtAgo(p.lastCycleAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
