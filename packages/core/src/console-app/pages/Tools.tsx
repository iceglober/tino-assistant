import { type JSX, useCallback, useEffect, useState } from "react";
import { PageShell } from "../components/PageShell.js";
import { RevealInput } from "../components/RevealInput.js";
import { useToast } from "../hooks/useToast.js";
import {
  deleteMcpServer,
  listMcpServers,
  type McpAuthKind,
  type McpScope,
  type McpServer,
  saveMcpServer,
  testMcpServer,
} from "../lib/api.js";

interface Draft {
  editing: boolean;
  scope: McpScope;
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  authKind: McpAuthKind;
  headerName: string;
  token: string;
  resultsVisibleTo: "asker" | "workspace";
}

const EMPTY: Omit<Draft, "scope"> = {
  editing: false,
  id: "",
  name: "",
  url: "",
  transport: "http",
  authKind: "bearer",
  headerName: "",
  token: "",
  resultsVisibleTo: "asker",
};

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

/**
 * Remote MCP servers. Workspace servers (admins add them) give every user's
 * agent their tools; personal servers use your own token and only you get them.
 */
export function Tools({ onBack }: { onBack: () => void }): JSX.Element {
  const toast = useToast();
  const [data, setData] = useState<{
    canManageWorkspace: boolean;
    workspace: McpServer[];
    personal: McpServer[];
  } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listMcpServers());
    } catch (err) {
      toast.show((err as Error).message, "err");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (s: McpServer): void => {
    setTestResult(null);
    setDraft({
      editing: true,
      scope: s.scope,
      id: s.id,
      name: s.name,
      url: s.url,
      transport: s.transport,
      authKind: s.auth.kind,
      headerName: s.auth.headerName ?? "",
      token: "",
      resultsVisibleTo: s.resultsVisibleTo,
    });
  };

  const input = (d: Draft) => ({
    name: d.name.trim() || d.id,
    url: d.url.trim(),
    transport: d.transport,
    auth: d.authKind === "header" ? { kind: d.authKind, headerName: d.headerName.trim() } : { kind: d.authKind },
    resultsVisibleTo: d.resultsVisibleTo,
    // Editing with an empty token field keeps the stored token.
    ...(d.token || !d.editing ? { token: d.token } : {}),
  });

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.show((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const test = (d: Draft): Promise<void> =>
    run(async () => {
      const r = await testMcpServer({ ...input(d), scope: d.scope, id: d.editing ? d.id : undefined });
      setTestResult(
        r.ok ? `connected — ${r.tools?.length ?? 0} tools: ${(r.tools ?? []).join(", ")}` : `failed: ${r.error}`,
      );
    });

  const save = (d: Draft): Promise<void> =>
    run(async () => {
      await saveMcpServer(d.scope, d.id, { ...input(d), enabled: true });
      toast.show(`${d.name || d.id} saved`, "ok");
      setDraft(null);
      await load();
    });

  const toggle = (s: McpServer): Promise<void> =>
    run(async () => {
      await saveMcpServer(s.scope, s.id, { enabled: !s.enabled });
      await load();
    });

  const remove = (s: McpServer): Promise<void> =>
    run(async () => {
      await deleteMcpServer(s.scope, s.id);
      toast.show(`${s.name} removed`, "ok");
      await load();
    });

  const list = (servers: McpServer[], canManage: boolean): JSX.Element =>
    servers.length === 0 ? (
      <p className="kb-sub">none yet.</p>
    ) : (
      <div>
        {servers.map((s) => (
          <div className="ws-row" key={`${s.scope}:${s.id}`}>
            <div className="ws-row__m">
              <b>{s.name}</b> {s.enabled ? null : <span className="badge badge-neutral">off</span>}
              <small>
                {s.url} · tools appear as <code>mcp_{s.id.replace(/-/g, "_")}_…</code>
                {s.hasToken ? " · token saved" : ""}
                {s.scope === "workspace"
                  ? s.resultsVisibleTo === "workspace"
                    ? " · usable in channels"
                    : " · DMs and web chat only"
                  : ""}
              </small>
            </div>
            {canManage ? (
              <div className="ws-row__actions">
                <button className="btn-ghost" type="button" disabled={busy} onClick={() => void toggle(s)}>
                  {s.enabled ? "turn off" : "turn on"}
                </button>
                <button className="btn-ghost" type="button" disabled={busy} onClick={() => edit(s)}>
                  edit
                </button>
                <button className="btn-danger" type="button" disabled={busy} onClick={() => void remove(s)}>
                  remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );

  const form = (d: Draft): JSX.Element => {
    const set = (patch: Partial<Draft>): void => setDraft({ ...d, ...patch });
    return (
      <section className="kb-card">
        <h2 className="kb-h2">
          {d.editing ? `edit ${d.name}` : `add a ${d.scope === "workspace" ? "workspace" : "personal"} server`}
        </h2>
        <div className="field-group">
          <label className="field-label" htmlFor="mcp-name">
            Name
          </label>
          <input
            id="mcp-name"
            className="field-input"
            value={d.name}
            placeholder="Linear"
            onChange={(e) =>
              set(d.editing ? { name: e.target.value } : { name: e.target.value, id: slug(e.target.value) })
            }
          />
          {d.editing ? null : (
            <div className="field-hint">
              id <code>{d.id || "…"}</code> — tools will be named <code>mcp_{(d.id || "id").replace(/-/g, "_")}_…</code>
            </div>
          )}
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="mcp-url">
            Server URL
          </label>
          <input
            id="mcp-url"
            className="field-input"
            value={d.url}
            placeholder="https://mcp.example.com/mcp"
            onChange={(e) => set({ url: e.target.value })}
          />
          <div className="field-hint">must be https. local and private-network addresses are refused.</div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="mcp-transport">
            Transport
          </label>
          <select
            id="mcp-transport"
            className="field-input"
            value={d.transport}
            onChange={(e) => set({ transport: e.target.value as "http" | "sse" })}
          >
            <option value="http">streamable HTTP (most servers)</option>
            <option value="sse">SSE (older servers)</option>
          </select>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="mcp-auth">
            Authentication
          </label>
          <select
            id="mcp-auth"
            className="field-input"
            value={d.authKind}
            onChange={(e) => set({ authKind: e.target.value as McpAuthKind })}
          >
            <option value="bearer">bearer token</option>
            <option value="header">token in a custom header</option>
            <option value="none">none</option>
          </select>
        </div>
        {d.authKind === "header" ? (
          <div className="field-group">
            <label className="field-label" htmlFor="mcp-header">
              Header name
            </label>
            <input
              id="mcp-header"
              className="field-input"
              value={d.headerName}
              placeholder="X-Api-Key"
              onChange={(e) => set({ headerName: e.target.value })}
            />
          </div>
        ) : null}
        {d.authKind !== "none" ? (
          <div className="field-group">
            <label className="field-label" htmlFor="mcp-token">
              Token
            </label>
            <RevealInput
              id="mcp-token"
              value={d.token}
              onChange={(v) => set({ token: v })}
              placeholder={d.editing ? "leave blank to keep the saved token" : "paste the token"}
              ariaLabel="Token"
            />
            <div className="field-hint">stored encrypted. never shown again.</div>
          </div>
        ) : null}
        {d.scope === "workspace" ? (
          <div className="field-group">
            <label className="field-label" htmlFor="mcp-visible">
              Who may see what it returns
            </label>
            <select
              id="mcp-visible"
              className="field-input"
              value={d.resultsVisibleTo}
              onChange={(e) => set({ resultsVisibleTo: e.target.value as "asker" | "workspace" })}
            >
              <option value="asker">only the person asking — DMs and web chat only</option>
              <option value="workspace">anyone in the workspace — also usable in channels</option>
            </select>
            <div className="field-hint">
              pick "anyone" only if everyone here may see everything this token can reach. it's never used in channels
              shared with people outside the company.
            </div>
          </div>
        ) : null}
        {testResult ? <p className="kb-sub">{testResult}</p> : null}
        <div className="btn-row">
          <button className="btn-ghost" type="button" onClick={() => setDraft(null)}>
            cancel
          </button>
          <button className="btn-ghost" type="button" disabled={busy || !d.url.trim()} onClick={() => void test(d)}>
            test connection
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || !d.id || !d.url.trim()}
            onClick={() => void save(d)}
          >
            save
          </button>
        </div>
      </section>
    );
  };

  const start = (scope: McpScope): void => {
    setTestResult(null);
    setDraft({ ...EMPTY, scope });
  };

  return (
    <PageShell title="tools" onBack={onBack}>
      {draft ? form(draft) : null}

      <section className="kb-card">
        <div className="kb-card-head">
          <h2 className="kb-h2">workspace servers</h2>
          {data?.canManageWorkspace && !draft ? (
            <button className="btn-ghost" type="button" onClick={() => start("workspace")}>
              + add
            </button>
          ) : null}
        </div>
        <p className="kb-sub">
          MCP servers everyone's tino can use, with one shared token.
          {data?.canManageWorkspace ? "" : " only admins can change these."}
        </p>
        {data ? list(data.workspace, data.canManageWorkspace) : <p className="kb-sub">loading…</p>}
      </section>

      <section className="kb-card">
        <div className="kb-card-head">
          <h2 className="kb-h2">your servers</h2>
          {!draft ? (
            <button className="btn-ghost" type="button" onClick={() => start("personal")}>
              + add
            </button>
          ) : null}
        </div>
        <p className="kb-sub">MCP servers only your tino uses, with your own token.</p>
        {data ? list(data.personal, true) : null}
      </section>
    </PageShell>
  );
}
