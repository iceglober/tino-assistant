import { type JSX, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import { saveMcpServer, removeMcpServer } from "../lib/api.js";
import { Modal } from "./Modal.js";
import { SaveButton, useSaveState } from "./SaveButton.js";
import { RevealInput } from "./RevealInput.js";
import type { McpServerEntry } from "../../mcp/catalog.js";

export function McpConnectModal({
  server,
  open,
  onClose,
  onChanged,
}: {
  server: McpServerEntry;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element | null {
  const toast = useToast();
  const { state, run } = useSaveState();

  const initialFields: Record<string, string> = {};
  for (const f of server.fields ?? []) initialFields[f.key] = "";
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialFields);

  const allFieldsFilled = server.fields.every((f) => (fieldValues[f.key] ?? "").trim() !== "");

  const onSave = async (): Promise<void> => {
    const ok = await run(async () => {
      const credentials: Record<string, string> = {};
      for (const f of server.fields ?? []) {
        credentials[f.key] = fieldValues[f.key] ?? "";
      }
      await saveMcpServer(server.id, credentials);
    });
    if (!ok) {
      toast.show("Could not save", "err");
      return;
    }
    toast.show("Server connected", "ok");
    onChanged();
    onClose();
  };

  const onDisconnect = async (): Promise<void> => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Disconnect ${server.displayName}?`);
      if (!ok) return;
    }
    try {
      await removeMcpServer(server.id);
      toast.show("Server removed", "ok");
      onChanged();
      onClose();
    } catch (err) {
      toast.show(`Could not delete: ${(err as Error).message}`, "err");
    }
  };

  const fields = (server.fields ?? []).map((f) => (
    <div key={f.key} className="detail-section">
      <div className="detail-label">{f.label ?? f.key}</div>
      <div className="field-group" style={{ marginBottom: 4 }}>
        {f.secret ? (
          <RevealInput
            value={fieldValues[f.key] ?? ""}
            onChange={(v) => setFieldValues((prev) => ({ ...prev, [f.key]: v }))}
            placeholder={f.placeholder ?? ""}
            ariaLabel={f.label ?? f.key}
          />
        ) : (
          <input
            className="field-input"
            type="text"
            value={fieldValues[f.key] ?? ""}
            onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            placeholder={f.placeholder ?? ""}
            autoComplete="off"
            aria-label={f.label ?? f.key}
          />
        )}
      </div>
    </div>
  ));

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={server.displayName}>
      <div style={{ padding: "12px 0" }}>
        {fields}
        <div className="btn-row">
          <SaveButton
            state={state}
            idleLabel="save"
            size="setup"
            onClick={onSave}
            disabled={!allFieldsFilled}
          />
        </div>
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
      </div>
    </Modal>
  );
}
