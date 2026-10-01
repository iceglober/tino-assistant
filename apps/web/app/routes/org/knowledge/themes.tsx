import type { KbItem, KbTopic } from "@tino/contracts";
import { useState } from "react";
import { ChunkList } from "../../../components/knowledge/ChunkList";
import { readScope } from "../../../components/knowledge/labels";
import { RouteError } from "../../../components/RouteError";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Notice } from "../../../components/ui/Notice";
import { Loading } from "../../../components/ui/Spinner";
import { useOrg } from "../../../layouts/app-shell";
import { orgApi } from "../../../lib/api";
import { errorMessage, fmtRange, plural } from "../../../lib/format";
import type { Route } from "./+types/themes";

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const scope = readScope(new URL(request.url).searchParams.get("scope"));
  const { items } = await orgApi(params.slug).topics(scope);
  return { topics: items, scope };
}

type Open =
  | { id: string; state: "loading" }
  | { id: string; state: "ok"; items: KbItem[] }
  | { id: string; state: "err"; error: string };

function Topic({
  topic,
  max,
  open,
  onToggle,
}: {
  topic: KbTopic;
  max: number;
  open: Open | null;
  onToggle: () => void;
}) {
  const expanded = open?.id === topic.id;
  return (
    <li className="topic">
      <button type="button" className="topic__row" aria-expanded={expanded} onClick={onToggle}>
        <span className="topic__label">{topic.label}</span>
        <span className="topic__bar" aria-hidden="true">
          <span style={{ width: `${Math.max(4, Math.round((topic.chunks / max) * 100))}%` }} />
        </span>
        <span className="topic__n">{plural(topic.chunks, "excerpt")}</span>
      </button>
      <p className="topic__summary">{topic.summary}</p>
      <p className="small muted">{fmtRange(topic.oldest, topic.newest)}</p>
      {expanded ? (
        <div className="topic__chunks">
          {open.state === "loading" ? (
            <Loading>reading excerpts…</Loading>
          ) : open.state === "err" ? (
            <Notice tone="err">{open.error}</Notice>
          ) : open.items.length ? (
            <ChunkList items={open.items} />
          ) : (
            <p className="muted small">no excerpts.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function Themes({ loaderData }: Route.ComponentProps) {
  const { topics, scope } = loaderData;
  const { slug } = useOrg();
  const [open, setOpen] = useState<Open | null>(null);
  const max = Math.max(1, ...topics.map((t) => t.chunks));

  const toggle = async (id: string) => {
    if (open?.id === id) {
      setOpen(null);
      return;
    }
    setOpen({ id, state: "loading" });
    try {
      const { items } = await orgApi(slug).topicChunks(scope, id);
      setOpen((o) => (o?.id === id ? { id, state: "ok", items } : o));
    } catch (err) {
      setOpen((o) => (o?.id === id ? { id, state: "err", error: errorMessage(err) } : o));
    }
  };

  if (topics.length === 0) {
    return (
      <EmptyState title="no themes yet">
        tino groups conversations into themes every few hours, once there are at least a few dozen excerpts in this
        scope.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <p className="small muted">conversations grouped by what they're about. open one to see its excerpts.</p>
      <ul className="topics">
        {topics.map((t) => (
          <Topic key={t.id} topic={t} max={max} open={open} onToggle={() => void toggle(t.id)} />
        ))}
      </ul>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
