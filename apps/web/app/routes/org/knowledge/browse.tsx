import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { ChunkList } from "../../../components/knowledge/ChunkList";
import { readScope } from "../../../components/knowledge/labels";
import { RouteError } from "../../../components/RouteError";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input, Select } from "../../../components/ui/Input";
import { orgApi } from "../../../lib/api";
import { fmtNumber } from "../../../lib/format";
import type { Route } from "./+types/browse";

const PAGE = 25;
const SOURCES = [
  { value: "slack_channel", label: "slack channels" },
  { value: "slack_thread", label: "slack threads" },
  { value: "slack_dm", label: "slack DMs" },
  { value: "gmail", label: "gmail" },
];

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const scope = readScope(sp.get("scope"));
  const q = sp.get("q")?.trim() ?? "";
  const source = sp.get("source") ?? "";
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const page = await orgApi(params.slug).browse({
    scope,
    q: q || undefined,
    source: source || undefined,
    limit: PAGE,
    offset,
  });
  return { page, scope, q, source, offset };
}

export default function Browse({ loaderData }: Route.ComponentProps) {
  const { page, scope, q, source, offset } = loaderData;
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const searching = navigation.state === "loading" && navigation.location?.pathname.endsWith("/browse");
  const at = (o: number) => {
    const p = new URLSearchParams(params);
    if (o > 0) p.set("offset", String(o));
    else p.delete("offset");
    return `?${p.toString()}`;
  };

  return (
    <div className="stack">
      <Form method="get" className="search" role="search" preventScrollReset>
        <input type="hidden" name="scope" value={scope} />
        <label htmlFor="kb-q" className="visually-hidden">
          search by meaning
        </label>
        <Input
          id="kb-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="search by meaning — or leave empty for the newest"
          className="grow"
        />
        <label htmlFor="kb-source" className="visually-hidden">
          source
        </label>
        <Select id="kb-source" name="source" defaultValue={source} options={SOURCES} placeholder="all sources" />
        <Button type="submit" variant="primary" loading={searching}>
          search
        </Button>
      </Form>

      {page.items.length === 0 ? (
        <EmptyState title={q ? "no matches" : "nothing indexed here yet"}>
          {q
            ? "try different words — search matches meaning, not exact text."
            : "connect Slack or Google and tino starts reading."}
        </EmptyState>
      ) : (
        <>
          <p className="small muted">
            {page.mode === "search"
              ? `${page.items.length} best matches for “${q}”`
              : `newest ${fmtNumber(offset + 1)}–${fmtNumber(offset + page.items.length)} of ${fmtNumber(page.total)}`}
          </p>
          <ChunkList items={page.items} />
          {page.mode === "recent" && (offset > 0 || offset + page.items.length < page.total) ? (
            <nav className="row" aria-label="pages">
              {offset > 0 ? (
                <Link className="btn btn--secondary btn--sm" to={at(Math.max(0, offset - PAGE))} preventScrollReset>
                  ← newer
                </Link>
              ) : null}
              {offset + page.items.length < page.total ? (
                <Link className="btn btn--secondary btn--sm" to={at(offset + PAGE)}>
                  older →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
