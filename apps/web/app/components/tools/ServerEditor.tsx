import type { McpAuthKind, McpScope, McpServer, McpServerInput, McpTestResult } from "@tino/contracts";
import { useState } from "react";
import { orgApi } from "../../lib/api";
import { errorMessage, slugify } from "../../lib/format";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Input, Select } from "../ui/Input";
import { Notice } from "../ui/Notice";
import { SecretInput } from "../ui/SecretInput";

export interface Draft {
  scope: McpScope;
  /** Set when editing a saved server. */
  existing: McpServer | null;
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  authKind: McpAuthKind;
  headerName: string;
  /** undefined = keep saved token, "" or string = new value, null = clear. */
  token: string | null | undefined;
  resultsVisibleTo: "asker" | "workspace";
}

export const newDraft = (scope: McpScope): Draft => ({
  scope,
  existing: null,
  id: "",
  name: "",
  url: "",
  transport: "http",
  authKind: "bearer",
  headerName: "",
  token: "",
  resultsVisibleTo: "asker",
});

export const draftFrom = (s: McpServer): Draft => ({
  scope: s.scope,
  existing: s,
  id: s.id,
  name: s.name,
  url: s.url,
  transport: s.transport,
  authKind: s.auth.kind,
  headerName: s.auth.headerName ?? "",
  token: undefined,
  resultsVisibleTo: s.resultsVisibleTo,
});

/** The body to PUT: an empty token field on an edit keeps the stored token. */
export function inputFrom(d: Draft): McpServerInput {
  const input: McpServerInput = {
    name: d.name.trim() || d.id,
    url: d.url.trim(),
    transport: d.transport,
    auth: d.authKind === "header" ? { kind: "header", headerName: d.headerName.trim() } : { kind: d.authKind },
  };
  if (d.scope === "workspace") input.resultsVisibleTo = d.resultsVisibleTo;
  if (d.authKind === "none") {
    if (d.existing?.hasToken) input.token = "";
  } else if (d.token === null) input.token = "";
  else if (typeof d.token === "string" && (d.token || !d.existing)) input.token = d.token;
  return input;
}

export function validate(d: Draft): Partial<Record<"name" | "url" | "headerName" | "token", string>> {
  const e: Partial<Record<"name" | "url" | "headerName" | "token", string>> = {};
  if (!d.id) e.name = "give it a name.";
  if (!/^https:\/\/\S+$/i.test(d.url.trim())) e.url = "use the server's https:// address.";
  if (d.authKind === "header" && !d.headerName.trim()) e.headerName = "which header carries the token?";
  if (d.authKind !== "none" && !d.existing?.hasToken && !d.token) e.token = "paste the token, or pick “none”.";
  return e;
}

export function ServerEditor({
  slug,
  draft,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  slug: string;
  draft: Draft;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: (d: Draft) => void;
  saving: boolean;
}) {
  const [test, setTest] = useState<McpTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const errors = validate(draft);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const editing = !!draft.existing;
  const toolPrefix = `mcp_${(draft.id || "id").replace(/-/g, "_")}_…`;

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(
        await orgApi(slug).testMcp({ ...inputFrom(draft), scope: draft.scope, id: editing ? draft.id : undefined }),
      );
    } catch (err) {
      setTest({ ok: false, error: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const submit = () => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      return;
    }
    onSave(draft);
  };

  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : null);

  return (
    <Dialog
      open
      onClose={onClose}
      onSubmit={submit}
      title={
        editing
          ? `edit ${draft.existing?.name}`
          : `add a ${draft.scope === "workspace" ? "workspace" : "personal"} tool`
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button onClick={() => void runTest()} loading={testing} disabled={!draft.url.trim()}>
            test connection
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            save
          </Button>
        </>
      }
    >
      <div>
        <Field
          label="name"
          error={err("name")}
          hint={
            editing ? (
              <>
                tools appear as <code>{toolPrefix}</code>
              </>
            ) : (
              <>
                id <code>{draft.id || "…"}</code> — tools appear as <code>{toolPrefix}</code>
              </>
            )
          }
        >
          <Input
            value={draft.name}
            placeholder="Linear"
            onChange={(e) =>
              set(editing ? { name: e.target.value } : { name: e.target.value, id: slugify(e.target.value, 24) })
            }
            autoFocus
          />
        </Field>
        <Field
          label="server URL"
          error={err("url")}
          hint="https only. local and private-network addresses are refused."
        >
          <Input
            mono
            value={draft.url}
            placeholder="https://mcp.example.com/mcp"
            onChange={(e) => set({ url: e.target.value })}
            inputMode="url"
            spellCheck={false}
          />
        </Field>
        <Field label="transport">
          <Select
            value={draft.transport}
            onChange={(e) => set({ transport: e.target.value as Draft["transport"] })}
            options={[
              { value: "http", label: "streamable HTTP (most servers)" },
              { value: "sse", label: "SSE (older servers)" },
            ]}
          />
        </Field>
        <Field label="authentication">
          <Select
            value={draft.authKind}
            onChange={(e) => set({ authKind: e.target.value as McpAuthKind })}
            options={[
              { value: "bearer", label: "bearer token" },
              { value: "header", label: "token in a custom header" },
              { value: "none", label: "none" },
            ]}
          />
        </Field>
        {draft.authKind === "header" ? (
          <Field label="header name" error={err("headerName")}>
            <Input
              mono
              value={draft.headerName}
              placeholder="X-Api-Key"
              onChange={(e) => set({ headerName: e.target.value })}
            />
          </Field>
        ) : null}
        {draft.authKind !== "none" ? (
          <Field label="token" error={err("token")} hint="stored encrypted. never shown again.">
            <SecretInput
              isSet={!!draft.existing?.hasToken}
              value={draft.token}
              onChange={(token) => set({ token })}
              placeholder="paste the token"
            />
          </Field>
        ) : null}
        {draft.scope === "workspace" ? (
          <Field
            label="who may see what it returns"
            hint="pick “anyone” only if everyone here may see everything this token can reach. it's never used in channels shared with people outside the company."
          >
            <Select
              value={draft.resultsVisibleTo}
              onChange={(e) => set({ resultsVisibleTo: e.target.value as Draft["resultsVisibleTo"] })}
              options={[
                { value: "asker", label: "only the person asking — DMs and web chat only" },
                { value: "workspace", label: "anyone in the workspace — also usable in channels" },
              ]}
            />
          </Field>
        ) : null}
      </div>

      {test ? (
        test.ok ? (
          <Notice tone="ok" title={`connected — ${test.tools?.length ?? 0} tools`} role="status">
            {test.tools?.length ? <p className="mono small">{test.tools.join(", ")}</p> : null}
          </Notice>
        ) : (
          <Notice tone="err" title="couldn't connect" role="alert">
            <p>{test.error}</p>
          </Notice>
        )
      ) : null}
    </Dialog>
  );
}
