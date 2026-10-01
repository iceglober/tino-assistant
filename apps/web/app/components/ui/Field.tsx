import { cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from "react";

interface FieldProps {
  label: ReactNode;
  /** Shown under the control. */
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  /** The control. Receives id, aria-describedby and aria-invalid. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  /** Use an explicit id when the control needs one (e.g. for tests or anchors). */
  id?: string;
  className?: string;
}

/** Label + control + hint + inline error, wired together for assistive tech. */
export function Field({ label, hint, error, optional, children, id, className }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `f${auto}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;

  return (
    <div className={className ? `field ${className}` : "field"}>
      <label className="field__label" htmlFor={controlId}>
        {label}
        {optional ? <span className="field__optional">optional</span> : null}
      </label>
      {control}
      {hint ? (
        <div className="field__hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
