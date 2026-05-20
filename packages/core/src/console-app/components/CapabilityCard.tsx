import { type JSX, type ReactNode, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import { putCapability, reloadCapabilities } from "../lib/api.js";
import { SaveButton, useSaveState } from "./SaveButton.js";

/**
 * Console-side mirror of the CapField type declared on each capability module
 * in `capabilities/types.ts`. Kept structurally identical (no shared module
 * because `console-app/` is bundled by Vite while `capabilities/` is server-only).
 */
interface CapField {
  key: string;
  label?: string;
  value?: string;
  placeholder?: string;
  secret?: boolean;
  /** Internal; the server uses this for round-tripping. UI ignores it. */
  target?: string;
  kind?: "string" | "string[]";
}

export interface CapabilityShape {
  id: string;
  displayName?: string;
  scope?: "shared" | "private";
  enabled?: boolean;
  fields?: CapField[];
  /** Whether the capability's tools are currently registered (from /api/health). */
  connected?: boolean;
}

const CAP_META: Record<string, { icon: string; name: string; desc: string }> = {
  github: { icon: "🐙", name: "GitHub", desc: "repos, issues, PRs" },
  calendar: { icon: "📅", name: "Calendar", desc: "Google Calendar events" },
  gmail: { icon: "✉️", name: "Gmail", desc: "search and read email" },
  linear: { icon: "📐", name: "Linear", desc: "issues and projects" },
  cloudwatch: { icon: "☁️", name: "CloudWatch", desc: "AWS logs and metrics" },
  slack: { icon: "💬", name: "Slack", desc: "search channels and DMs" },
  "slack-personal": { icon: "🔒", name: "Slack (personal)", desc: "read your DMs with a user token" },
};

/**
 * One capability card — collapsible header + enable toggle + fields.
 *
 * Each card mirrors `capability.<id>` in the config store. The server-side
 * GET /api/capabilities returns a `fields` array sourced from the capability
 * module's declared `fieldSchema` (with `value` filled from the stored blob).
 * Save sends `{ enabled, fields: [{key, value}] }` which the server reconstructs
 * into the `CapabilityConfig` shape the registry reads.
 *
 * Status:
 *   - `connected: true`  → the capability's tools are currently registered (green dot)
 *   - `connected: false` → enabled in config but tools failed to register (red dot)
 *   - `connected` undefined → fall back to the legacy enabled-vs-disabled label.
 */
export function CapabilityCard({
  cap,
  onChanged,
}: {
  cap: CapabilityShape;
  onChanged?: () => void | Promise<void>;
}): JSX.Element {
  const meta = CAP_META[cap.id] ?? {
    icon: "⚙️",
    name: cap.displayName ?? cap.id,
    desc: "",
  };
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean>(cap.enabled !== false);
  const initialFields: Record<string, string> = {};
  for (const f of cap.fields ?? []) initialFields[f.key] = f.value ?? "";
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialFields);
  const toast = useToast();
  const { state, run } = useSaveState();

  const stateClass = enabled ? "state-ok" : "state-disabled";

  const buildPayload = (
    overrideEnabled?: boolean,
  ): {
    enabled: boolean;
    fields: Array<{ key: string; value: string }>;
  } => ({
    enabled: overrideEnabled ?? enabled,
    fields: (cap.fields ?? []).map((f) => ({
      key: f.key,
      value: fieldValues[f.key] ?? f.value ?? "",
    })),
  });

  const onToggle = async (next: boolean): Promise<void> => {
    setEnabled(next);
    try {
      await putCapability(cap.id, buildPayload(next));
      // Wave 3.2 — apply the toggle without a restart. Surface failures
      // softly (the server still has the new config; only the live tools
      // didn't swap), but don't roll back the UI state — the next reload
      // attempt will pick it up.
      const reload = await reloadCapabilities();
      if (!reload.ok) toast.show(`Saved, but reload failed: ${reload.error ?? "unknown"}`, "err");
      if (onChanged) await onChanged();
    } catch (err) {
      toast.show(`Could not update capability: ${(err as Error).message}`, "err");
      setEnabled(!next);
    }
  };

  const onSave = async (): Promise<void> => {
    const ok = await run(async () => {
      await putCapability(cap.id, buildPayload());
    });
    if (!ok) {
      toast.show("Could not save", "err");
      return;
    }
    // Wave 3.2 — apply the new credentials/settings without a restart.
    const reload = await reloadCapabilities();
    if (!reload.ok) toast.show(`Saved, but reload failed: ${reload.error ?? "unknown"}`, "err");
    if (onChanged) await onChanged();
  };

  const fields: ReactNode = (cap.fields ?? []).map((f) => (
    <div key={f.key} className="detail-section">
      <div className="detail-label">{f.label ?? f.key}</div>
      <div className="field-group" style={{ marginBottom: 4 }}>
        <input
          className="field-input"
          type={f.secret ? "password" : "text"}
          value={fieldValues[f.key] ?? ""}
          onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
          placeholder={f.placeholder ?? ""}
          autoComplete="off"
          aria-label={f.label ?? f.key}
        />
      </div>
    </div>
  ));

  // Status: prefer the live `connected` flag (from /api/health); fall back to enabled label.
  const statusBadge: ReactNode =
    typeof cap.connected === "boolean" ? (
      cap.connected ? (
        <span className="status-connected" style={{ color: "var(--ok)" }}>
          ● on
        </span>
      ) : enabled ? (
        <span className="status-connected" style={{ color: "var(--err)" }}>
          ● needs setup
        </span>
      ) : (
        <span style={{ fontSize: "0.714rem", color: "var(--text-dim)" }}>off</span>
      )
    ) : enabled ? (
      <span className="status-connected">● on</span>
    ) : (
      <span style={{ fontSize: "0.714rem", color: "var(--text-dim)" }}>off</span>
    );

  return (
    <div className={`cap-card ${stateClass}${open ? " open" : ""}`}>
      {/* biome-ignore lint/a11y/useSemanticElements: card-header is a click target with nested layout; replacing with <button> would alter styling/structure */}
      <div
        className="cap-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className="cap-card-icon">{meta.icon}</span>
        <div className="cap-card-meta">
          <div className="cap-card-name">{meta.name}</div>
          <div className="cap-card-desc">{meta.desc}</div>
        </div>
        <div className="cap-card-status">{statusBadge}</div>
        <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="cap-detail-wrap">
        <div className="cap-detail-inner">
          <div className="cap-detail">
            <div className="detail-section">
              <div className="toggle-wrap">
                <label className="toggle" aria-label={`Enable ${meta.name}`}>
                  <input type="checkbox" checked={enabled} onChange={(e) => void onToggle(e.target.checked)} />
                  <div className="toggle-track" />
                  <div className="toggle-thumb" />
                </label>
                <span className="fw-label">enabled</span>
              </div>
            </div>
            {fields}
            <div className="btn-row">
              <SaveButton state={state} idleLabel="save" size="setup" onClick={onSave} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
