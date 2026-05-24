import { type JSX, type ReactNode, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { CapabilityEntry } from "../lib/api.js";
import {
  deleteUserCapability,
  putCapability,
  putUserCapability,
  reloadCapabilities,
} from "../lib/api.js";
import { Modal } from "./Modal.js";
import { SaveButton, useSaveState } from "./SaveButton.js";

const CAP_META: Record<string, { icon: string; name: string }> = {
  github: { icon: "🐙", name: "GitHub" },
  calendar: { icon: "📅", name: "Calendar" },
  gmail: { icon: "✉️", name: "Gmail" },
  linear: { icon: "📐", name: "Linear" },
  cloudwatch: { icon: "☁️", name: "CloudWatch" },
  slack: { icon: "💬", name: "Slack" },
  "slack-personal": { icon: "🔒", name: "Slack (personal)" },
};

export function CapabilityModal({
  cap,
  userId,
  open,
  onClose,
  onChanged,
}: {
  cap: CapabilityEntry;
  userId: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element | null {
  const meta = CAP_META[cap.id] ?? { icon: "⚙️", name: cap.displayName ?? cap.id };

  return (
    <Modal open={open} onClose={onClose} title={`${meta.icon} ${meta.name}`}>
      <BasicTab cap={cap} userId={userId} onChanged={onChanged} onClose={onClose} />
    </Modal>
  );
}

function BasicTab({
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

  const initialFields: Record<string, string> = {};
  for (const f of cap.fields ?? []) initialFields[f.key] = f.value ?? "";
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialFields);

  const isUserCap = cap.scope === "private";
  const oauthConfig = (cap.id === "gmail" || cap.id === "calendar") ? {
    url: "/api/oauth/google/authorize",
    label: "connect google account",
    connectedLabel: "connected via Google OAuth",
    description: "grants read-only access to Gmail and Calendar",
  } : cap.id === "slack-personal" ? {
    url: "/api/oauth/slack/authorize",
    label: "connect Slack",
    connectedLabel: "connected via Slack OAuth",
    description: "grants read-only search and DM access",
  } : null;

  const buildPayload = () => ({
    enabled,
    fields: (cap.fields ?? []).map((f) => ({
      key: f.key,
      value: fieldValues[f.key] ?? f.value ?? "",
    })),
  });

  const onSave = async (): Promise<void> => {
    const ok = await run(async () => {
      if (isUserCap) {
        await putUserCapability(userId, cap.id, buildPayload());
      } else {
        await putCapability(cap.id, buildPayload());
      }
    });
    if (!ok) {
      toast.show("Could not save", "err");
      return;
    }
    const reload = await reloadCapabilities();
    if (!reload.ok) toast.show(`Saved, but reload failed: ${reload.error ?? "unknown"}`, "err");
    onChanged();
  };

  const onToggle = async (next: boolean): Promise<void> => {
    setEnabled(next);
    try {
      const payload = { ...buildPayload(), enabled: next };
      if (isUserCap) {
        await putUserCapability(userId, cap.id, payload);
      } else {
        await putCapability(cap.id, payload);
      }
      const reload = await reloadCapabilities();
      if (!reload.ok) toast.show(`Saved, but reload failed: ${reload.error ?? "unknown"}`, "err");
      onChanged();
    } catch (err) {
      toast.show(`Could not update: ${(err as Error).message}`, "err");
      setEnabled(!next);
    }
  };

  const onDisconnect = async (): Promise<void> => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Disconnect ${cap.displayName ?? cap.id}?`);
      if (!ok) return;
    }
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

  return (
    <div style={{ padding: "12px 0" }}>
      {oauthConfig && cap.enabled ? (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <span style={{ color: "var(--ok)", fontSize: 13 }}>● {oauthConfig.connectedLabel}</span>
        </div>
      ) : oauthConfig && !cap.enabled ? (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <a
            href={oauthConfig.url}
            className="btn btn-setup"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            {oauthConfig.label}
          </a>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>
            {oauthConfig.description}
          </div>
        </div>
      ) : (
        <>
          <div className="detail-section">
            <div className="toggle-wrap">
              <label className="toggle" aria-label={`Enable ${cap.displayName ?? cap.id}`}>
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
        </>
      )}

      {cap.enabled && (
        <div style={{ borderTop: "1px solid var(--border-sub)", paddingTop: 12, marginTop: 16 }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ color: "var(--err)", padding: 0, fontSize: "0.786rem" }}
            onClick={() => void onDisconnect()}
          >
            disconnect
          </button>
        </div>
      )}
    </div>
  );
}
