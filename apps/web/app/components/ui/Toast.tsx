import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastTone = "ok" | "err" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  text: ReactNode;
}

interface ToastApi {
  show: (text: ReactNode, tone?: ToastTone) => void;
  ok: (text: ReactNode) => void;
  err: (text: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const GLYPH: Record<ToastTone, string> = { ok: "✓", err: "✕", info: "·" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (text: ReactNode, tone: ToastTone = "info") => {
      const id = next.current++;
      setItems((all) => [...all.slice(-3), { id, tone, text }]);
      window.setTimeout(() => dismiss(id), tone === "err" ? 8000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show, ok: (t) => show(t, "ok"), err: (t) => show(t, "err") }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className="toasts" aria-live="polite" aria-label="notifications">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === "err" ? "alert" : "status"}>
            <span className="toast__glyph" aria-hidden="true">
              {GLYPH[t.tone]}
            </span>
            <span>{t.text}</span>
            <button type="button" className="toast__close" aria-label="dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

const noop: ToastApi = { show: () => {}, ok: () => {}, err: () => {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}
