import { type JSX, useState } from "react";
import { useConfig } from "../hooks/useConfig.js";
import { useToast } from "../hooks/useToast.js";
import { deleteConfig, putConfig } from "../lib/api.js";
import { SaveButton, useSaveState } from "./SaveButton.js";

/**
 * "all config entries" table — list, add, delete with undo.
 *
 * Mirror: `html.ts:1352-1404` (markup) + the `loadConfigTable`,
 * `confirmDelete`, `doDelete`, `addConfigEntry` functions at
 * `html.ts:1700-1791`.
 */
export function ConfigTable(): JSX.Element {
  const { entries, loading, error, refresh } = useConfig();
  const toast = useToast();
  const { state, run } = useSaveState();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [keyError, setKeyError] = useState<string>("");

  const fmtTs = (ts: string | undefined): string => {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      const diff = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diff < 60) return "just now";
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return d.toLocaleDateString();
    } catch {
      return "—";
    }
  };

  const maskVal = (key: string, val: string): string => {
    const sensitive = ["token", "secret", "password", "key", "credential"];
    if (sensitive.some((s) => key.toLowerCase().includes(s))) {
      return val ? "••••••••" : "—";
    }
    return val || "—";
  };

  const onDelete = async (key: string): Promise<void> => {
    setConfirming(null);
    const entry = entries.find((e) => e.key === key);
    const prevValue = entry?.value ?? null;
    try {
      await deleteConfig(key);
      await refresh();
      toast.show(`deleted ${key}`, "ok", async () => {
        if (prevValue !== null) {
          // value comes back JSON-stringified from the store; restore raw
          let restored: unknown = prevValue;
          try {
            restored = JSON.parse(prevValue);
          } catch {
            /* leave as string */
          }
          await putConfig(key, restored);
          await refresh();
          toast.show(`restored ${key}`, "ok");
        }
      });
    } catch (err) {
      toast.show(`delete failed: ${(err as Error).message}`, "err");
    }
  };

  const onAdd = async (): Promise<void> => {
    if (!newKey.trim()) {
      setKeyError("Key is required");
      return;
    }
    setKeyError("");
    const ok = await run(async () => {
      await putConfig(newKey.trim(), newVal.trim());
    });
    if (ok) {
      setNewKey("");
      setNewVal("");
      await refresh();
    } else {
      toast.show("Could not add entry", "err");
    }
  };

  return (
    <div className={`raw-section${open ? " open" : ""}`}>
      <button
        className="raw-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="raw-body-wrap"
      >
        <svg className="raw-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        all config entries
      </button>
      <div className="raw-body-wrap" id="raw-body-wrap">
        <div className="raw-body-inner">
          <div className="raw-body">
            <table className="config-table">
              <thead>
                <tr>
                  <th className="col-key">key</th>
                  <th className="col-val">value</th>
                  <th className="col-ts">updated</th>
                  <th className="col-act"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      loading…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      error: {error}
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      no config entries yet
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => (
                    <tr key={e.key}>
                      <td className="col-key">{e.key}</td>
                      <td className="col-val">{maskVal(e.key, e.value)}</td>
                      <td className="col-ts">{fmtTs(e.updatedAt)}</td>
                      <td className="col-act">
                        {confirming === e.key ? (
                          <div className="delete-confirm visible">
                            <span className="delete-confirm-text">delete {e.key}?</span>
                            <button type="button" className="delete-confirm-yes" onClick={() => void onDelete(e.key)}>
                              yes
                            </button>
                            <button type="button" className="delete-confirm-no" onClick={() => setConfirming(null)}>
                              no
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-danger btn-setup"
                            style={{ fontSize: "0.714rem", padding: "3px 8px", minHeight: 28 }}
                            onClick={() => setConfirming(e.key)}
                            aria-label={`Delete ${e.key}`}
                          >
                            delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="add-form">
              <div className="add-form-fields">
                <div className="field-group">
                  <label className="field-label" htmlFor="new-key">
                    Key
                  </label>
                  <input
                    id="new-key"
                    className="field-input"
                    type="text"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="config.key"
                    autoComplete="off"
                    aria-invalid={keyError ? "true" : undefined}
                  />
                  <div className={`field-error${keyError ? " visible" : ""}`} role="alert" aria-live="polite">
                    {keyError}
                  </div>
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="new-val">
                    Value
                  </label>
                  <input
                    id="new-val"
                    className="field-input"
                    type="text"
                    value={newVal}
                    onChange={(e) => setNewVal(e.target.value)}
                    placeholder="value"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 4 }}>
                <SaveButton
                  state={state}
                  idleLabel="add entry"
                  savingLabel="adding…"
                  savedLabel="✓ added"
                  size="setup"
                  onClick={onAdd}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
