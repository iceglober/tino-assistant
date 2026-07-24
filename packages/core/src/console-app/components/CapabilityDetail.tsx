import { type JSX, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { CapabilityEntry } from "../lib/api.js";
import { deleteUserCapability, putCapability, putUserCapability, reloadCapabilities } from "../lib/api.js";
import { CAP_META } from "../lib/capabilityMeta.js";
import { SaveButton, useSaveState } from "./SaveButton.js";

const OAUTH: Record<string, { url: string; label: string; connected: string; desc: string }> = {
  gmail: {
    url: "/api/oauth/google/authorize",
    label: "Connect Google",
    connected: "Connected via Google",
    desc: "Read-only access to Gmail and Calendar.",
  },
  calendar: {
    url: "/api/oauth/google/authorize",
    label: "Connect Google",
    connected: "Connected via Google",
    desc: "Read-only access to Gmail and Calendar.",
  },
  "slack-personal": {
    url: "/api/oauth/slack/authorize",
    label: "Connect Slack",
    connected: "Connected via Slack",
    desc: "Read-only search and DM access as you.",
  },
};

/** Inline detail pane for a capability — config fields, enable toggle, disconnect. */
export function CapabilityDetail({
  cap,
  userId,
  onChanged,
  onClose,
}: {
  cap: CapabilityEntry;
  userId: string;
  onChanged: () => void;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const { state, run } = useSaveState();
  const [enabled, setEnabled] = useState(cap.enabled);
  const [openConfig, setOpenConfig] = useState(false);

  const initial: Record<string, string> = {};
  for (const f of cap.fields ?? []) initial[f.key] = f.value ?? "";
  const [values, setValues] = useState<Record<string, string>>(initial);

  const meta = CAP_META[cap.id] ?? { icon: "⚙️", name: cap.displayName ?? cap.id, desc: "" };
  const isUserCap = cap.scope === "private";
  const oauth = OAUTH[cap.id] ?? null;

  const payload = () => ({
    enabled,
    fields: (cap.fields ?? []).map((f) => ({ key: f.key, value: values[f.key] ?? "" })),
  });

  const persist = async (p: ReturnType<typeof payload>): Promise<void> => {
    if (isUserCap) await putUserCapability(userId, cap.id, p);
    else await putCapability(cap.id, p);
    const reload = await reloadCapabilities();
    if (!reload.ok) toast.show(`Saved, but reload failed: ${reload.error ?? "unknown"}`, "err");
  };

  const onSave = async (): Promise<void> => {
    const ok = await run(async () => persist(payload()));
    if (!ok) {
      toast.show("Could not save", "err");
      return;
    }
    onChanged();
  };

  const onToggle = async (next: boolean): Promise<void> => {
    setEnabled(next);
    try {
      await persist({ ...payload(), enabled: next });
      onChanged();
    } catch (err) {
      toast.show(`Could not update: ${(err as Error).message}`, "err");
      setEnabled(!next);
    }
  };

  const onDisconnect = async (): Promise<void> => {
    if (typeof window !== "undefined" && !window.confirm(`Disconnect ${meta.name}?`)) return;
    try {
      await deleteUserCapability(userId, cap.id);
      toast.show("Capability removed", "ok");
      await reloadCapabilities();
      onChanged();
      onClose();
    } catch (err) {
      toast.show(`Could not delete: ${(err as Error).message}`, "err");
    }
  };

  return (
    <div className="md-detail">
      <div className="md-detail__head">
        <div className="md-detail__ic">{meta.icon}</div>
        <div className="md-detail__title">
          <h2>{meta.name}</h2>
          <span className={`cap-badge ${cap.enabled ? "is-active" : "is-avail"}`}>
            <span className="cap-badge__d" />
            {cap.enabled ? "Active" : "Available"}
          </span>
        </div>
        <button type="button" className="md-detail__close" onClick={onClose} aria-label="Close detail">
          ✕
        </button>
      </div>
      <div className="md-detail__body">
        <p className="md-detail__lead">{meta.desc || `Configure the ${meta.name} capability.`}</p>

        {oauth ? (
          cap.enabled ? (
            <div style={{ padding: "4px 0 var(--s4)" }}>
              <span style={{ color: "var(--ok)", fontSize: "var(--t-sm)" }}>● {oauth.connected}</span>
            </div>
          ) : (
            <div>
              <a href={oauth.url} className="btn btn-setup" style={{ display: "inline-block", textDecoration: "none" }}>
                {oauth.label}
              </a>
              <div style={{ fontSize: "var(--t-xs)", color: "var(--text-dim)", marginTop: 8 }}>{oauth.desc}</div>
            </div>
          )
        ) : (
          <>
            <div className="toggle-wrap" style={{ marginBottom: "var(--s4)" }}>
              <label className="toggle" aria-label={`Enable ${meta.name}`}>
                <input type="checkbox" checked={enabled} onChange={(e) => void onToggle(e.target.checked)} />
                <div className="toggle-track" />
                <div className="toggle-thumb" />
              </label>
              <span className="fw-label">{enabled ? "Active" : "Off"}</span>
            </div>

            {(cap.fields ?? []).length > 0 && (
              <div className={`fold ${openConfig ? "is-open" : ""}`}>
                <button type="button" className="fold__head" onClick={() => setOpenConfig((o) => !o)}>
                  <span className="fold__t">Configuration</span>
                  <span className="fold__chev">›</span>
                </button>
                <div className="fold__body">
                  {(cap.fields ?? []).map((f) => (
                    <div className="cap-field" key={f.key}>
                      <label htmlFor={`f-${cap.id}-${f.key}`}>{f.label ?? f.key}</label>
                      <input
                        id={`f-${cap.id}-${f.key}`}
                        className="field-input"
                        type={f.secret ? "password" : "text"}
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.secret && f.hasValue ? "•••••••• (unchanged)" : (f.placeholder ?? "")}
                        autoComplete="off"
                        aria-label={f.label ?? f.key}
                      />
                    </div>
                  ))}
                  <div className="btn-row">
                    <SaveButton state={state} idleLabel="Save" size="setup" onClick={onSave} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {cap.enabled && !oauth && (
          <div style={{ borderTop: "1px solid var(--border-sub)", paddingTop: "var(--s4)", marginTop: "var(--s4)" }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ color: "var(--err)", padding: 0, fontSize: "var(--t-sm)" }}
              onClick={() => void onDisconnect()}
            >
              disconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
