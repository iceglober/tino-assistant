import type { GmailExclusion } from "@tino/contracts";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { RouteError } from "../../../components/RouteError";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Field } from "../../../components/ui/Field";
import { Input, Select } from "../../../components/ui/Input";
import { Notice } from "../../../components/ui/Notice";
import { type ActionResult, useFetcherToast } from "../../../hooks/useFetcherToast";
import { useOrg } from "../../../layouts/app-shell";
import { orgApi } from "../../../lib/api";
import { errorMessage, fmtAgo } from "../../../lib/format";
import type { Route } from "./+types/dont-learn-from";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { view: await orgApi(params.slug).dontLearnFrom() };
}

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResult> {
  const { gmail, added } = (await request.json()) as { gmail: GmailExclusion[]; added: boolean };
  try {
    const saved = await orgApi(params.slug).saveDontLearnFrom(gmail);
    const when = saved.appliesBy ? ` (by ${fmtAgo(saved.appliesBy).replace(/^in /, "about ")})` : "";
    return {
      ok: true,
      message: added
        ? `saved — what tino already learned from matching mail is removed on the next cycle${when}`
        : "removed — new matching mail will be learned from again (older mail isn't re-read)",
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const keyOf = (e: GmailExclusion) => (e.kind === "gmailLabel" ? `l:${e.labelId}` : `s:${e.query}`);

export default function DontLearnFrom({ loaderData }: Route.ComponentProps) {
  const { view } = loaderData;
  const { slug } = useOrg();
  const fetcher = useFetcher();
  const [search, setSearch] = useState("");
  useFetcherToast(fetcher, (r) => r.ok && setSearch(""));

  if (view.enabled === false) {
    return <EmptyState title="the knowledge base is off">there's nothing to exclude while it's off.</EmptyState>;
  }

  // Show the pending list straight away (optimistic), falling back to what's saved.
  const pending = fetcher.json as { gmail: GmailExclusion[] } | undefined;
  const current = pending?.gmail ?? view.exclusions.gmail;
  const busy = fetcher.state !== "idle";
  const save = (gmail: GmailExclusion[], added: boolean) =>
    fetcher.submit({ gmail, added }, { method: "post", encType: "application/json" });

  const labelsUsed = new Set(current.flatMap((e) => (e.kind === "gmailLabel" ? [e.labelId] : [])));
  const filtersUsed = new Set(
    current.flatMap((e) => (e.kind === "gmailSearch" && e.fromFilterId ? [e.fromFilterId] : [])),
  );
  const labelName = (id: string) => view.options?.labels.find((l) => l.id === id)?.name ?? id;

  return (
    <div className="stack-lg">
      <p className="prose">
        mail that looks real but isn't — domain warm-up, bots, test sends. tino won't learn from it, and forgets what it
        already learned. when you ask tino something directly, it still searches everything.
      </p>

      {!view.gmailConnected ? (
        <Notice tone="info" title="connect Gmail to pick from your labels and filters">
          <p>
            <Link to={`/${slug}/connections`}>connect Google →</Link> you can still add Gmail searches below.
          </p>
        </Notice>
      ) : null}
      {view.optionsError ? <Notice tone="warn">couldn't read your Gmail labels: {view.optionsError}</Notice> : null}

      <section aria-labelledby="excluded-title">
        <h3 id="excluded-title" className="subhead">
          excluded
        </h3>
        {current.length === 0 ? (
          <p className="muted small">nothing excluded yet.</p>
        ) : (
          <ul className="item-list">
            {current.map((e, i) => (
              <li key={keyOf(e)} className="item-row">
                <div className="item-row__main">
                  <strong>{e.name}</strong>
                  <p className="item-row__meta">{e.kind === "gmailLabel" ? "Gmail label" : <code>{e.query}</code>}</p>
                </div>
                <div className="item-row__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      save(
                        current.filter((_, j) => j !== i),
                        false,
                      )
                    }
                  >
                    remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-title" className="stack">
        <h3 id="add-title" className="subhead">
          add
        </h3>
        {view.options ? (
          <div className="grid-2">
            <Field label="a Gmail label">
              <Select
                value=""
                disabled={busy}
                placeholder="choose a label…"
                onChange={(ev) => {
                  const l = view.options?.labels.find((x) => x.id === ev.target.value);
                  if (l) save([...current, { kind: "gmailLabel", labelId: l.id, name: l.name }], true);
                }}
                options={view.options.labels
                  .filter((l) => !labelsUsed.has(l.id))
                  .map((l) => ({ value: l.id, label: l.name }))}
              />
            </Field>
            <Field label="what a Gmail filter matches">
              <Select
                value=""
                disabled={busy}
                placeholder="choose a filter…"
                onChange={(ev) => {
                  const f = view.options?.filters.find((x) => x.id === ev.target.value);
                  if (f)
                    save(
                      [...current, { kind: "gmailSearch", query: f.query, name: f.description, fromFilterId: f.id }],
                      true,
                    );
                }}
                options={view.options.filters
                  .filter((f) => !filtersUsed.has(f.id))
                  .map((f) => ({
                    value: f.id,
                    label: `${f.description}${f.labelIds.length ? ` → ${f.labelIds.map(labelName).join(", ")}` : ""}`,
                  }))}
              />
            </Field>
          </div>
        ) : null}
        <form
          className="search"
          onSubmit={(ev) => {
            ev.preventDefault();
            const q = search.trim();
            if (q) save([...current, { kind: "gmailSearch", query: q, name: q }], true);
          }}
        >
          <Field
            label="a Gmail search"
            className="grow"
            hint={
              <>
                same syntax as Gmail's search box, e.g. <code>from:(warmup.example.com)</code>
              </>
            }
          >
            <Input
              mono
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='from:(warmup.example.com) or "WRM-7Q2"'
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !search.trim()} loading={busy}>
            exclude
          </Button>
        </form>
      </section>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
