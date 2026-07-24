import { type JSX, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { McpAuth, McpServer, McpTransport } from "../lib/api.js";
import { removeMcpServer, saveMcpServer, testMcpServer } from "../lib/api.js";

const STEPS = ["Where", "Transport", "Auth", "Test"] as const;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "server"
  );
}

/** MCP Tools capability body — server list + add-server wizard. Rendered inline
 *  inside the capability row. */
export function McpServersDetail({ servers, onChanged }: { servers: McpServer[]; onChanged: () => void }): JSX.Element {
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  const remove = async (serverId: string): Promise<void> => {
    if (typeof window !== "undefined" && !window.confirm(`Remove MCP server "${serverId}"?`)) return;
    try {
      await removeMcpServer(serverId);
      toast.show("Server removed", "ok");
      onChanged();
    } catch (err) {
      toast.show(`Could not remove: ${(err as Error).message}`, "err");
    }
  };

  const remoteServers = servers.filter((s) => s.transport !== "stdio");

  return (
    <div className="mcp-body">
      {remoteServers.length === 0 && !adding && (
        <p className="cap-row__hint">Add a Streamable-HTTP or SSE endpoint. Its tools become tino's.</p>
      )}

      {remoteServers.map((s) => (
        <div className="mcp-server" key={s.serverId}>
          <div className="mcp-server__ic">◆</div>
          <div className="mcp-server__m">
            <b>{s.displayName}</b>
            <span className="mcp-server__u">{s.url}</span>
          </div>
          <span className="mcp-chip">{s.transport === "streamable-http" ? "http" : s.transport}</span>
          <span className="mcp-chip">{s.auth.kind}</span>
          <span className={`cap-badge ${s.enabled ? "is-active" : "is-avail"}`}>
            <span className="cap-badge__d" />
            {s.enabled ? "on" : "off"}
          </span>
          <button
            type="button"
            className="btn-ghost"
            style={{ color: "var(--err)", fontSize: "var(--t-sm)", padding: "0 4px" }}
            onClick={() => void remove(s.serverId)}
          >
            remove
          </button>
        </div>
      ))}

      {adding ? (
        <AddServerWizard
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      ) : (
        <button
          type="button"
          className="btn btn-setup"
          style={{ marginTop: "var(--s2)" }}
          onClick={() => setAdding(true)}
        >
          ＋ Add a server
        </button>
      )}
    </div>
  );
}

function AddServerWizard({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [transport, setTransport] = useState<McpTransport>("streamable-http");
  const [authKind, setAuthKind] = useState<McpAuth["kind"]>("bearer");
  const [headerName, setHeaderName] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [tools, setTools] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const LAST = STEPS.length - 1;
  const auth: McpAuth = { kind: authKind, ...(authKind === "header" ? { headerName } : {}) };
  const credentials = authKind === "none" ? undefined : { token };

  const canNext =
    step === 0
      ? name.trim().length > 0 && /^https:\/\/.+/.test(url)
      : step === 2
        ? authKind === "none" || token.length > 0
        : true;

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setTools(null);
    try {
      const res = await testMcpServer({ url, transport, auth, credentials });
      if (res.ok && res.tools) {
        setTools(res.tools);
      } else {
        toast.show(`Connection failed: ${res.error ?? "unknown"}`, "err");
      }
    } catch (err) {
      toast.show(`Connection failed: ${(err as Error).message}`, "err");
    } finally {
      setTesting(false);
    }
  };

  const finish = async (): Promise<void> => {
    setSaving(true);
    try {
      await saveMcpServer(slugify(name), {
        enabled: true,
        credentials: credentials ?? {},
        settings: { displayName: name.trim(), url, transport, auth },
      });
      toast.show(`${name.trim()} added`, "ok");
      onDone();
    } catch (err) {
      toast.show(`Could not save: ${(err as Error).message}`, "err");
      setSaving(false);
    }
  };

  return (
    <div className="wiz">
      <div className="wiz__top">
        <h4>Add a server</h4>
        <span className="wiz__stepof">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>
      <div className="wiz__dots">
        {STEPS.map((s, i) => (
          <span key={s} className={`wiz__dot ${i < step ? "is-done" : i === step ? "is-cur" : ""}`} />
        ))}
      </div>

      <div className="wiz__body">
        {step === 0 && (
          <>
            <h5>What is it, and where does it live?</h5>
            <p className="wiz__sub">A friendly name and the endpoint. tino connects to it directly.</p>
            <div className="cap-field">
              <label htmlFor="wz-name">Name</label>
              <input
                id="wz-name"
                className="field-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Docs"
                autoComplete="off"
              />
            </div>
            <div className="cap-field">
              <label htmlFor="wz-url">Server address</label>
              <input
                id="wz-url"
                className="field-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com"
                autoComplete="off"
              />
              <span className="hint">Must be https. Private &amp; loopback addresses are blocked.</span>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h5>How does tino reach it?</h5>
            <p className="wiz__sub">Remote servers speak Streamable HTTP or SSE.</p>
            <div className="cap-seg">
              {(["streamable-http", "sse"] as McpTransport[]).map((t) => (
                <label key={t}>
                  <input type="radio" name="wz-transport" checked={transport === t} onChange={() => setTransport(t)} />
                  {t === "streamable-http" ? "Streamable HTTP" : "SSE"}
                </label>
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h5>How does it sign in?</h5>
            <p className="wiz__sub">Credentials are encrypted, stored only for you, and never shown again.</p>
            <div className="cap-field">
              <label htmlFor="wz-auth">Method</label>
              <select
                id="wz-auth"
                className="field-input"
                value={authKind}
                onChange={(e) => setAuthKind(e.target.value as McpAuth["kind"])}
              >
                <option value="bearer">Bearer token</option>
                <option value="header">Custom header</option>
                <option value="none">None</option>
              </select>
            </div>
            {authKind === "header" && (
              <div className="cap-field">
                <label htmlFor="wz-header">Header name</label>
                <input
                  id="wz-header"
                  className="field-input"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  placeholder="X-Api-Key"
                  autoComplete="off"
                />
              </div>
            )}
            {authKind !== "none" && (
              <div className="cap-field">
                <label htmlFor="wz-token">Token</label>
                <input
                  id="wz-token"
                  className="field-input"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </div>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <h5>Let's make sure it works.</h5>
            <p className="wiz__sub">tino connects and lists the tools it offers before anything is saved.</p>
            {tools ? (
              <div className="wiz__found">
                <b>
                  ✓ Connected — found {tools.length} tool{tools.length === 1 ? "" : "s"}
                </b>
                <div className="mcp-tools">
                  {tools.map((t) => (
                    <span className="mcp-tool" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ) : testing ? (
              <div className="wiz__testing">
                <span className="wiz__spin" /> Connecting to {url}…
              </div>
            ) : (
              <button type="button" className="btn btn-setup" onClick={() => void runTest()}>
                ⚡ Test connection
              </button>
            )}
          </>
        )}
      </div>

      <div className="wiz__foot">
        <button type="button" className="btn-ghost" onClick={onCancel} style={{ padding: 0 }}>
          Cancel
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </button>
        {step < LAST ? (
          <button type="button" className="btn btn-setup" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-setup" onClick={() => void finish()} disabled={saving}>
            {saving ? "Adding…" : "Add server"}
          </button>
        )}
      </div>
    </div>
  );
}
