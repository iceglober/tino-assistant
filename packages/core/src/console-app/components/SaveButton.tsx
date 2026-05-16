import { type JSX, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Primary CTA with built-in loading/saved/error visual states.
 *
 * Mirror: the inline `setBtnLoading`/`setBtnSuccess`/`setBtnError` helpers
 * at `html.ts:1502-1535`. Same timings (saved persists 2s, error 3s).
 */
export function SaveButton({
  state,
  idleLabel,
  savingLabel = "saving…",
  savedLabel = "✓ saved",
  errorLabel = "failed — retry",
  size = "normal",
  onClick,
  id,
  disabled,
  ariaDescribedBy,
}: {
  state: SaveState;
  idleLabel: string;
  savingLabel?: string;
  savedLabel?: string;
  errorLabel?: string;
  size?: "normal" | "large" | "setup";
  onClick: () => void | Promise<void>;
  id?: string;
  disabled?: boolean;
  ariaDescribedBy?: string;
}): JSX.Element {
  const sizeClass = size === "large" ? " btn-primary-lg" : size === "setup" ? " btn-setup" : "";
  const stateClass =
    state === "saving" ? " saving" : state === "saved" ? " saved" : state === "error" ? " save-error" : "";

  const label =
    state === "saving" ? savingLabel : state === "saved" ? savedLabel : state === "error" ? errorLabel : idleLabel;

  return (
    <button
      id={id}
      type="button"
      className={`btn btn-primary${sizeClass}${stateClass}`}
      onClick={() => void onClick()}
      disabled={disabled || state === "saving"}
      aria-describedby={ariaDescribedBy}
    >
      {label}
    </button>
  );
}

/**
 * Hook that drives a SaveButton through `idle → saving → saved/error → idle`.
 *
 * Use:
 *   const { state, run } = useSaveState();
 *   await run(async () => { await putConfig(...) });
 */
export function useSaveState(): {
  state: SaveState;
  run: (fn: () => Promise<void>) => Promise<boolean>;
} {
  const [state, setState] = useState<SaveState>("idle");

  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    setState("saving");
    try {
      await fn();
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
      return true;
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
      return false;
    }
  };

  return { state, run };
}
