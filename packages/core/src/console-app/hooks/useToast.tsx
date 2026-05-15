import { createContext, useContext, useState, useRef, type ReactNode, type JSX } from 'react';

export type ToastLevel = 'ok' | 'err' | '';

interface ToastState {
  msg: string;
  level: ToastLevel;
  undoFn: (() => void) | null;
  visible: boolean;
}

interface ToastApi {
  show: (msg: string, level?: ToastLevel, undoFn?: (() => void) | null) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Toast container — mirror of the inline `showToast` helper at
 * `html.ts:1444-1459`. Lives at the root of the app so any component can
 * call `useToast()` and surface a global message.
 */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<ToastState>({
    msg: '',
    level: '',
    undoFn: null,
    visible: false,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((s) => ({ ...s, visible: false }));
  };

  const show: ToastApi['show'] = (msg, level = '', undoFn = null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({ msg, level, undoFn, visible: true });
    timerRef.current = setTimeout(() => {
      setState((s) => ({ ...s, visible: false }));
    }, undoFn ? 5000 : 2500);
  };

  const handleUndo = (): void => {
    if (state.undoFn) state.undoFn();
    hide();
  };

  return (
    <ToastContext.Provider value={{ show, hide }}>
      {children}
      <div id="toast" className={state.visible ? `show ${state.level}` : ''} role="status" aria-live="polite">
        <span id="toast-msg">{state.msg}</span>
        {state.undoFn ? (
          <button id="toast-undo" onClick={handleUndo} type="button">undo</button>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
