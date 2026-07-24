import { type JSX, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { CapabilityEntry } from "../lib/api.js";
import { deleteUserCapability, putCapability, putUserCapability, reloadCapabilities } from "../lib/api.js";
import { CAP_META } from "../lib/capabilityMeta.js";
import { SaveButton, useSaveState } from "./SaveButton.js";

const OAUTH: Record<string, { url: string; label: string }> = {
  gmail: { url: "/api/oauth/google/authorize", label: "Connect Google" },
  calendar: { url: "/api/oauth/google/authorize", label: "Connect Google" },
  "slack-personal": { url: "/api/oauth/slack/authorize", label: "Connect Slack" },
};

/**
 * One capability as a list row: enable/disable inline, expand for config.
 * OAuth caps show Connect when unconfigured, then a toggle + Disconnect.
 */
export function CapabilityRow({
  cap,
  userId,
  onChanged,
}: {
  cap: CapabilityEntry;
  userId: string;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const { state, run } = useSaveState();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(cap.enabled);

  const initial: Record<string, string> = {};
  for (const f of cap.fields ?? []) initial[f.key] = f.value ?? "";
  const [values, setValues] = useState<Record<string, string>>(initial);

  const meta = CAP_META[cap.id] ?? { icon: "⚙️", name: cap.displayName ?? cap.id, desc: "" };
  const isUserCap = cap.scope === "private";
  const oauth = OAUTH[cap.id] ?? null;
  const hasFields = (cap.fields ?? []).length > 0;
  // OAuth caps are "connected" once enabled; before that there's nothing to toggle.
  const connectable = !!oauth && !cap.enabled;

  const persist = async (p: { enabled: boolean; fields: { key: string; value: string }[] }): Promise<void> => {
    if (isUserCap) await putUserCapability(userId, cap.id, p);
    else await putCapability(cap.id, p);
    const reload = await reloadCapabilities();
    if (!reload.ok) toast.show(`Saved, but reload failed: ${reload.error ?? "unknown"}`, "err");
  };
  const payload = () => ({
    enabled,
    fields: (cap.fields ?? []).map((f) => ({ key: f.key, value: values[f.key] ?? "" })),
  });

  const onToggle = async (next: boolean): Promise<void> => {
    setEnabled(next);
    try {
      await persist({ ...payload(), enabled: next });
      toast.show(next ? `${meta.name} enabled` : `${meta.name} disabled`, "ok");
      onChanged();
    } catch (err) {
      setEnabled(!next);
      toast.show(`Could not update: ${(err as Error).message}`, "err");
    }
  };

  const onSave = async (): Promise<void> => {
    const ok = await run(() => persist(payload()));
    if (!ok) {
      toast.show("Could not save", "err");
      return;
    }
    toast.show("Saved", "ok");
    onChanged();
  };

  const onDisconnect = async (): Promise<void> => {
    if (typeof window !== "undefined" && !window.confirm(`Disconnect ${meta.name}?`)) return;
    try {
      await deleteUserCapability(userId, cap.id);
      toast.show(`${meta.name} disconnected`, "ok");
      await reloadCapabilities();
      onChanged();
    } catch (err) {
      toast.show(`Could not disconnect: ${(err as Error).message}`, "err");
    }
  };

  return (
    <div className={`cap-row ${open ? "is-open" : ""}`}>
      <div className="cap-row__head">
        <button type="button" className="cap-row__main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="cap-row__ic">{meta.icon}</span>
          <span className="cap-row__m">
            <b>{meta.name}</b>
            {meta.desc && <small>{meta.desc}</small>}
          </span>
        </button>
        <div className="cap-row__control">
          {connectable ? (
            <a className="btn btn-setup" href={oauth?.url}>
              {oauth?.label}
            </a>
          ) : (
            <label className="toggle" aria-label={`${enabled ? "Disable" : "Enable"} ${meta.name}`}>
              <input type="checkbox" checked={enabled} onChange={(e) => void onToggle(e.target.checked)} />
              <div className="toggle-track" />
              <div className="toggle-thumb" />
            </label>
          )}
        </div>
        <button
          type="button"
          className="cap-row__chev"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
        >
          ›
        </button>
      </div>

      {open && (
        <div className="cap-row__body">
          {connectable ? (
            <p className="cap-row__hint">Connect to enable {meta.name}. Access is scoped and revocable.</p>
          ) : (
            <>
              {hasFields ? (
                <>
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
                      />
                    </div>
                  ))}
                  <div className="cap-row__actions">
                    <SaveButton state={state} idleLabel="Save" size="setup" onClick={onSave} />
                    {oauth && (
                      <button
                        type="button"
                        className="btn-ghost cap-row__disconnect"
                        onClick={() => void onDisconnect()}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="cap-row__actions">
                  <span className="cap-row__hint">No settings — toggle to enable.</span>
                  {oauth && (
                    <button type="button" className="btn-ghost cap-row__disconnect" onClick={() => void onDisconnect()}>
                      Disconnect
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
