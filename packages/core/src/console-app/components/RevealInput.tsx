import { type JSX, useId, useState } from "react";

/**
 * Password input with a "show/hide" reveal button.
 *
 * Mirror: `html.ts:1075-1083` + the `toggleReveal` helper at `html.ts:1642-1649`.
 */
export function RevealInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  ariaDescribedBy,
  invalid,
  onBlur,
  id: idProp,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  invalid?: boolean;
  onBlur?: () => void;
  id?: string;
}): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const reactId = useId();
  const id = idProp ?? reactId;
  return (
    <div className="field-input-wrap">
      <input
        id={id}
        className="field-input"
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid ? "true" : undefined}
        onBlur={onBlur}
      />
      <button
        className="reveal-btn"
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={`${revealed ? "Hide" : "Reveal"} ${ariaLabel ?? "token"}`}
      >
        {revealed ? "hide" : "show"}
      </button>
    </div>
  );
}
