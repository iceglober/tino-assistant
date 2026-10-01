import type { McpScope, McpServer, McpServerInput } from "@tino/contracts";
import { useState } from "react";
import { useFetcher } from "react-router";
import { PageHeader } from "../../components/PageHeader";
import { RouteError } from "../../components/RouteError";
import { type Draft, draftFrom, inputFrom, newDraft, ServerEditor } from "../../components/tools/ServerEditor";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Section } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { type ActionResult, useFetcherToast } from "../../hooks/useFetcherToast";
import { useOrg } from "../../layouts/app-shell";
import { orgApi } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import { jsonBody } from "../../lib/json-body";
import { invalidateOverview } from "../../lib/session";
import type { Route } from "./+types/tools";

export const meta: Route.MetaFunction = () => [{ title: "tools · tino" }];

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return orgApi(params.slug).mcpServers();
}

type ToolIntent =
  | { intent: "save"; scope: McpScope; id: string; name: string; input: McpServerInput }
  | { intent: "toggle"; scope: McpScope; id: string; name: string; enabled: boolean }
  | { intent: "delete"; scope: McpScope; id: string; name: string };

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResult> {
  const body = (await request.json()) as ToolIntent;
  const api = orgApi(params.slug);
  try {
    if (body.intent === "save") {
      await api.saveMcp(body.scope, body.id, { ...body.input, enabled: true });
      invalidateOverview(params.slug);
      return { ok: true, intent: body.intent, message: `${body.name} saved` };
    }
    if (body.intent === "toggle") {
      await api.saveMcp(body.scope, body.id, { enabled: body.enabled });
      return { ok: true, intent: body.intent, message: `${body.name} turned ${body.enabled ? "on" : "off"}` };
    }
    await api.deleteMcp(body.scope, body.id);
    invalidateOverview(params.slug);
    return { ok: true, intent: body.intent, message: `${body.name} removed` };
  } catch (err) {
    return { ok: false, intent: body.intent, error: errorMessage(err) };
  }
}

function ServerRow({
  server,
  canManage,
  onEdit,
  onRemove,
}: {
  server: McpServer;
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher);
  const busy = fetcher.state !== "idle";
  const enabled = busy && fetcher.json ? (fetcher.json as { enabled: boolean }).enabled : server.enabled;

  return (
    <li className={enabled ? "item-row" : "item-row is-off"}>
      <div className="item-row__main">
        <div className="row">
          <strong>{server.name}</strong>
          {enabled ? null : <Badge>○ off</Badge>}
          {server.scope === "workspace" ? (
            server.resultsVisibleTo === "workspace" ? (
              <Badge tone="accent">usable in channels</Badge>
            ) : (
              <Badge tone="outline">DMs and web chat only</Badge>
            )
          ) : null}
        </div>
        <p className="item-row__meta">
          <span className="mono">{server.url}</span>
          <span>
            {server.transport === "sse" ? "SSE" : "HTTP"} ·{" "}
            {server.auth.kind === "none"
              ? "no auth"
              : server.hasToken
                ? `token saved${server.auth.kind === "header" ? ` (${server.auth.headerName})` : ""}`
                : "no token"}
          </span>
        </p>
      </div>
      {canManage ? (
        <div className="item-row__actions">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={enabled}
            disabled={busy}
            onClick={() =>
              fetcher.submit(
                { intent: "toggle", scope: server.scope, id: server.id, name: server.name, enabled: !enabled },
                { method: "post", encType: "application/json" },
              )
            }
          >
            turn {enabled ? "off" : "on"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            edit
          </Button>
          <Button size="sm" variant="danger" onClick={onRemove}>
            remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export default function Tools({ loaderData }: Route.ComponentProps) {
  const { slug } = useOrg();
  const data = loaderData;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const saver = useFetcher();
  const remover = useFetcher();
  useFetcherToast(saver, (r) => r.ok && setDraft(null));
  useFetcherToast(remover, () => setRemoving(null));

  const list = (servers: McpServer[], canManage: boolean, scope: McpScope) =>
    servers.length === 0 ? (
      <EmptyState
        title={scope === "workspace" ? "no workspace tools yet" : "no personal tools yet"}
        action={
          canManage ? (
            <Button variant="secondary" onClick={() => setDraft(newDraft(scope))}>
              add one
            </Button>
          ) : null
        }
      >
        {scope === "workspace"
          ? canManage
            ? "add an MCP server with a shared token, and every person's tino gets its tools."
            : "admins can add MCP servers that everyone's tino can use."
          : "add an MCP server with your own token — only your tino will use it."}
      </EmptyState>
    ) : (
      <ul className="item-list">
        {servers.map((s) => (
          <ServerRow
            key={`${s.scope}:${s.id}`}
            server={s}
            canManage={canManage}
            onEdit={() => setDraft(draftFrom(s))}
            onRemove={() => setRemoving(s)}
          />
        ))}
      </ul>
    );

  return (
    <div className="stack-lg">
      <PageHeader
        title="tools"
        lede="MCP servers give tino more to work with — your tracker, your docs, your own APIs. tino calls them when a question needs them."
      />

      <Section
        title="workspace tools"
        sub={
          data.canManageWorkspace
            ? "shared with everyone's tino, using one token you provide. choose per server whether results may appear in channels."
            : "shared with everyone's tino. only admins can change these."
        }
        actions={
          data.canManageWorkspace && data.workspace.length ? (
            <Button size="sm" variant="secondary" onClick={() => setDraft(newDraft("workspace"))}>
              + add
            </Button>
          ) : null
        }
      >
        {list(data.workspace, data.canManageWorkspace, "workspace")}
      </Section>

      <Section
        title="your tools"
        sub="only your tino uses these, with your own token."
        actions={
          data.personal.length ? (
            <Button size="sm" variant="secondary" onClick={() => setDraft(newDraft("personal"))}>
              + add
            </Button>
          ) : null
        }
      >
        {list(data.personal, true, "personal")}
      </Section>

      {draft ? (
        <ServerEditor
          slug={slug}
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          saving={saver.state !== "idle"}
          onSave={(d) =>
            saver.submit(
              jsonBody({ intent: "save", scope: d.scope, id: d.id, name: d.name || d.id, input: inputFrom(d) }),
              { method: "post", encType: "application/json" },
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={!!removing}
        title={`remove ${removing?.name ?? ""}?`}
        confirmLabel="remove"
        destructive
        busy={remover.state !== "idle"}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          remover.submit(
            { intent: "delete", scope: removing.scope, id: removing.id, name: removing.name },
            { method: "post", encType: "application/json" },
          )
        }
      >
        <p>
          {removing?.scope === "workspace"
            ? "everyone's tino loses these tools, and the saved token is deleted."
            : "your tino loses these tools, and the saved token is deleted."}
        </p>
      </ConfirmDialog>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
