import type { KbScope, KbStatus } from "@tino/contracts";
import { useEffect, useState } from "react";
import { Link, Outlet, type ShouldRevalidateFunctionArgs, useRouteLoaderData, useSearchParams } from "react-router";
import { readScope, SCOPE_BLURB } from "../../../components/knowledge/labels";
import { PageHeader } from "../../../components/PageHeader";
import { RouteError } from "../../../components/RouteError";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Segmented, TabNav } from "../../../components/ui/Tabs";
import { useOrg } from "../../../layouts/app-shell";
import { orgApi } from "../../../lib/api";
import { fmtAgo, fmtNumber, fmtRange, plural } from "../../../lib/format";
import type { Route } from "./+types/layout";

export const meta: Route.MetaFunction = () => [{ title: "knowledge · tino" }];

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { status: await orgApi(params.slug).kbStatus() };
}

/** Only re-read the status when the org changes or someone asks; scope and tab changes don't need it. */
export function shouldRevalidate({
  currentParams,
  nextParams,
  currentUrl,
  nextUrl,
  formMethod,
}: ShouldRevalidateFunctionArgs) {
  return currentParams.slug !== nextParams.slug || !!formMethod || currentUrl.href === nextUrl.href;
}

/** The KB status, for the tabs below. */
export function useKbStatus(): KbStatus {
  const data = useRouteLoaderData<typeof clientLoader>("knowledge");
  return data?.status ?? { enabled: false };
}

/** The status, refreshed every 15s so a running cycle shows live. */
function useLiveStatus(slug: string, initial: KbStatus): KbStatus {
  const [status, setStatus] = useState(initial);
  useEffect(() => setStatus(initial), [initial]);
  useEffect(() => {
    if (!initial.enabled) return;
    const ctrl = new AbortController();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      orgApi(slug)
        .kbStatus(ctrl.signal)
        .then(setStatus)
        .catch(() => {});
    }, 15_000);
    return () => {
      window.clearInterval(id);
      ctrl.abort();
    };
  }, [slug, initial.enabled]);
  return status;
}

function Coverage({ status, scope }: { status: KbStatus; scope: KbScope }) {
  const stats = status.scopes?.[scope];
  const ix = status.indexer;
  return (
    <div className="coverage">
      <p className="coverage__line">
        <strong>{plural(stats?.facts ?? 0, "fact")}</strong> distilled from{" "}
        <strong>{plural(stats?.chunks ?? 0, "excerpt")}</strong>
        {stats?.pending ? <> · {fmtNumber(stats.pending)} waiting to be read</> : null}
        {stats?.oldestMs && stats.newestMs ? <> · covering {fmtRange(stats.oldestMs, stats.newestMs)}</> : null}
      </p>
      <p className="coverage__line small muted">
        {ix?.running ? (
          <Badge tone="accent" dot>
            indexing now
          </Badge>
        ) : (
          <Badge tone="outline">idle</Badge>
        )}{" "}
        last cycle {fmtAgo(ix?.lastCycle?.at)}
        {ix ? ` · runs every ${Math.max(1, Math.round(ix.intervalMs / 60_000))}m` : ""}
        {ix?.nextRunAt && !ix.running ? ` · next ${fmtAgo(ix.nextRunAt)}` : ""}
        {ix?.lastCycle?.errors ? (
          <span className="err-text"> · {plural(ix.lastCycle.errors, "error")} last cycle</span>
        ) : null}
        {status.distilling === false ? <span className="err-text"> · not distilling: no model configured</span> : null}
      </p>
    </div>
  );
}

export default function KnowledgeLayout({ loaderData }: Route.ComponentProps) {
  const { slug, isAdmin } = useOrg();
  const status = useLiveStatus(slug, loaderData.status);
  const [params, setParams] = useSearchParams();
  const scope = readScope(params.get("scope"));
  const base = `/${slug}/knowledge`;

  if (!status.enabled) {
    return (
      <div className="stack-lg">
        <PageHeader title="knowledge" lede="what tino has learned from your team's history." />
        <EmptyState
          title="the knowledge base is off"
          action={isAdmin ? <Link to={`/${slug}/settings/knowledge`}>knowledge settings →</Link> : null}
        >
          {status.reason ?? "it turns on once a model with embeddings is set up."}{" "}
          {isAdmin ? "" : "an admin can turn it on."}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="knowledge"
        lede="what tino has concluded from your history, the excerpts behind it, and what it's reading now."
        actions={
          <Segmented<KbScope>
            label="scope"
            value={scope}
            onChange={(v) =>
              setParams(
                (p) => {
                  p.set("scope", v);
                  p.delete("kind");
                  p.delete("offset");
                  return p;
                },
                { preventScrollReset: true },
              )
            }
            options={[
              { value: "private", label: "just you" },
              { value: "workspace", label: "everyone" },
            ]}
          />
        }
      />
      <div className="stack">
        <p className="muted small">{SCOPE_BLURB[scope]}</p>
        <Coverage status={status} scope={scope} />
      </div>
      <TabNav
        label="knowledge views"
        keep={["scope"]}
        tabs={[
          { to: base, label: "what tino knows", end: true },
          { to: `${base}/themes`, label: "themes" },
          { to: `${base}/browse`, label: "browse" },
          { to: `${base}/activity`, label: "activity" },
          { to: `${base}/dont-learn-from`, label: "don't learn from" },
        ]}
      />
      <Outlet />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
