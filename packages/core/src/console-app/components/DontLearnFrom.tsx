import { type JSX, useCallback, useEffect, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import { type DontLearnFromView, type GmailExclusion, getDontLearnFrom, saveDontLearnFrom } from "../lib/api.js";

/**
 * Mail tino should not learn from — domain warmup, bots, anything that looks
 * real but isn't. Picks come from the person's own Gmail labels and filters, so
 * Gmail stays the one place that decides what's noise. Adding one also removes
 * what tino already learned from matching mail, on the next indexing cycle.
 */
export function DontLearnFrom(): JSX.Element | null {
  const toast = useToast();
  const [view, setView] = useState<DontLearnFromView | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setView(await getDontLearnFrom());
    } catch (err) {
      toast.show((err as Error).message, "err");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view || view.enabled === false) return null;
  const current = view.exclusions.gmail;

  const save = async (next: GmailExclusion[], message: string): Promise<void> => {
    setBusy(true);
    try {
      const saved = await saveDontLearnFrom(next);
      setView({ ...view, exclusions: saved.exclusions });
      toast.show(message, "ok");
    } catch (err) {
      toast.show((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const add = (e: GmailExclusion): Promise<void> =>
    save([...current, e], "saved — matching mail already learned is removed within the next indexing cycle");
  const remove = (i: number): Promise<void> =>
    save(
      current.filter((_, j) => j !== i),
      "removed — new matching mail will be learned from (older mail isn't re-read)",
    );

  const labelsUsed = new Set(current.flatMap((e) => (e.kind === "gmailLabel" ? [e.labelId] : [])));
  const filtersUsed = new Set(
    current.flatMap((e) => (e.kind === "gmailSearch" && e.fromFilterId ? [e.fromFilterId] : [])),
  );
  const labelName = (id: string): string => view.options?.labels.find((l) => l.id === id)?.name ?? id;

  return (
    <section className="kb-card">
      <h2 className="kb-h2">don't learn from</h2>
      <p className="kb-sub">
        mail that looks real but isn't — domain warmup, bots, test sends. tino skips it, and forgets what it already
        learned from it. live searches you ask for still see everything.
      </p>

      {!view.gmailConnected ? (
        <p className="kb-sub">connect Google from the chat header to pick from your Gmail labels and filters.</p>
      ) : null}
      {view.optionsError ? <p className="kb-sub kb-err">{view.optionsError}</p> : null}

      {current.length === 0 ? <p className="kb-sub">nothing excluded yet.</p> : null}
      {current.map((e, i) => (
        <div className="ws-row" key={e.kind === "gmailLabel" ? `l:${e.labelId}` : `s:${e.query}`}>
          <div className="ws-row__m">
            <b>{e.name}</b>
            <small>{e.kind === "gmailLabel" ? "Gmail label" : <code>{e.query}</code>}</small>
          </div>
          <div className="ws-row__actions">
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => void remove(i)}>
              remove
            </button>
          </div>
        </div>
      ))}

      {view.options ? (
        <div className="ws-invite">
          <select
            className="field-input"
            aria-label="exclude a Gmail label"
            value=""
            disabled={busy}
            onChange={(ev) => {
              const label = view.options?.labels.find((l) => l.id === ev.target.value);
              if (label) void add({ kind: "gmailLabel", labelId: label.id, name: label.name });
            }}
          >
            <option value="">exclude a label…</option>
            {view.options.labels
              .filter((l) => !labelsUsed.has(l.id))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
          <select
            className="field-input"
            aria-label="exclude what a Gmail filter matches"
            value=""
            disabled={busy}
            onChange={(ev) => {
              const f = view.options?.filters.find((x) => x.id === ev.target.value);
              if (f) void add({ kind: "gmailSearch", query: f.query, name: f.description, fromFilterId: f.id });
            }}
          >
            <option value="">exclude what a filter matches…</option>
            {view.options.filters
              .filter((f) => !filtersUsed.has(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.description}
                  {f.labelIds.length ? ` → ${f.labelIds.map(labelName).join(", ")}` : ""}
                </option>
              ))}
          </select>
        </div>
      ) : null}

      <form
        className="ws-invite"
        onSubmit={(ev) => {
          ev.preventDefault();
          const q = search.trim();
          if (!q) return;
          void add({ kind: "gmailSearch", query: q, name: q }).then(() => setSearch(""));
        }}
      >
        <input
          className="field-input"
          aria-label="exclude a Gmail search"
          placeholder='or a Gmail search, e.g. from:(warmup.example.com) or "WRM-7Q2"'
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !search.trim()}>
          exclude
        </button>
      </form>
    </section>
  );
}
