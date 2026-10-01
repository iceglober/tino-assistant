import type { KbFact, KbFactKind } from "@tino/contracts";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { FactCard } from "../../../components/knowledge/FactCard";
import { KIND_ORDER, KIND_PLURAL, readScope } from "../../../components/knowledge/labels";
import { RouteError } from "../../../components/RouteError";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useOrg } from "../../../layouts/app-shell";
import { orgApi } from "../../../lib/api";
import { fmtNumber, plural } from "../../../lib/format";
import type { Route } from "./+types/facts";
import { useKbStatus } from "./layout";

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const scope = readScope(sp.get("scope"));
  const kindRaw = sp.get("kind");
  const kind = KIND_ORDER.includes(kindRaw as KbFactKind) ? (kindRaw as KbFactKind) : undefined;
  const page = await orgApi(params.slug).knowledge({ scope, kind, limit: 200 });
  return { page, scope, kind };
}

/** Facts grouped by subject, so related claims read as one thing tino knows about. */
function group(facts: KbFact[]) {
  const by = new Map<string, KbFact[]>();
  for (const f of facts) by.set(f.subject, [...(by.get(f.subject) ?? []), f]);
  return [...by.entries()]
    .map(([subject, items]) => ({
      subject,
      items: [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
      newest: Math.max(...items.map((i) => Date.parse(i.lastSeen) || 0)),
    }))
    .sort((a, b) => b.newest - a.newest);
}

export default function Facts({ loaderData }: Route.ComponentProps) {
  const { page, scope, kind } = loaderData;
  const status = useKbStatus();
  const { slug, isAdmin } = useOrg();
  const [params] = useSearchParams();
  const groups = useMemo(() => group(page.items), [page.items]);
  const kinds = [...page.kinds].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const stats = status.scopes?.[scope];
  const withKind = (k: string | null) => {
    const p = new URLSearchParams(params);
    if (k) p.set("kind", k);
    else p.delete("kind");
    return `?${p.toString()}`;
  };

  return (
    <div className="stack">
      {kinds.length > 0 ? (
        <nav className="chips" aria-label="filter by kind">
          <Link to={withKind(null)} className="chip" aria-current={!kind ? "true" : undefined} preventScrollReset>
            everything <span className="chip__n">{fmtNumber(page.kinds.reduce((n, k) => n + k.count, 0))}</span>
          </Link>
          {kinds.map((k) => (
            <Link
              key={k.kind}
              to={withKind(kind === k.kind ? null : k.kind)}
              className="chip"
              aria-current={kind === k.kind ? "true" : undefined}
              preventScrollReset
            >
              {KIND_PLURAL[k.kind]} <span className="chip__n">{fmtNumber(k.count)}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState title={`nothing distilled about ${scope === "private" ? "you" : "your workspace"} yet`}>
          {status.distilling === false ? (
            <>
              no model is configured, so tino can index but can't draw conclusions.{" "}
              {isAdmin ? <Link to={`/${slug}/settings/model`}>add a model</Link> : "an admin can add one."}
            </>
          ) : stats && stats.pending > 0 ? (
            <>
              {plural(stats.pending, "excerpt")} {stats.pending === 1 ? "is" : "are"} queued. tino distills a batch
              every cycle, so this fills in over the next few hours.
            </>
          ) : stats && stats.chunks === 0 ? (
            scope === "private" ? (
              <>
                nothing indexed for you yet. <Link to={`/${slug}/connections`}>connect Slack or Google</Link> and tino
                starts reading.
              </>
            ) : (
              "workspace coverage comes from the public channels connected people belong to."
            )
          ) : (
            "the next cycle will pick this up."
          )}
        </EmptyState>
      ) : (
        <>
          {page.total > page.items.length ? (
            <p className="small muted">
              showing the newest {fmtNumber(page.items.length)} of {fmtNumber(page.total)}.
            </p>
          ) : null}
          {groups.map((g) => (
            <section key={g.subject} className="subject" aria-label={g.subject}>
              <h3 className="subject__title">
                {g.subject} <span className="muted small">{plural(g.items.length, "fact")}</span>
              </h3>
              <ul className="facts">
                {g.items.map((f) => (
                  <FactCard key={f.id} fact={f} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
