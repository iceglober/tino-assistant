import { useId, useState } from "react";
import { Button } from "./Button";

interface SecretInputProps {
  id?: string;
  /** Whether a value is saved on the server. The value itself is never sent back. */
  isSet: boolean;
  /** undefined = keep what's saved, string = replace with this, null = clear. */
  value: string | null | undefined;
  onChange: (next: string | null | undefined) => void;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
}

/**
 * Write-only secret field. When something is saved it shows "set" with
 * replace / clear; otherwise a password input with a reveal toggle.
 */
export function SecretInput({
  id,
  isSet,
  value,
  onChange,
  placeholder,
  disabled,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: SecretInputProps) {
  const auto = useId();
  const inputId = id ?? `s${auto}`;
  const [reveal, setReveal] = useState(false);
  const editing = typeof value === "string" || !isSet;

  if (value === null) {
    return (
      <div className="secret">
        <span className="secret__state" id={inputId}>
          <span aria-hidden="true">✕</span> will be removed when you save
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(undefined)} disabled={disabled}>
          undo
        </Button>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="secret">
        <span className="secret__state" id={inputId} aria-describedby={describedBy}>
          <span className="secret__dots" aria-hidden="true">
            ••••••••
          </span>
          <span>saved</span>
        </span>
        <Button size="sm" onClick={() => onChange("")} disabled={disabled}>
          replace
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)} disabled={disabled}>
          clear
        </Button>
      </div>
    );
  }

  return (
    <div className="secret">
      <div className="secret__edit">
        <input
          id={inputId}
          className="input input--mono"
          type={reveal ? "text" : "password"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? (isSet ? "paste the new value" : "paste it here")}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
        />
        <Button size="sm" variant="ghost" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
          {reveal ? "hide" : "show"}
        </Button>
        {isSet ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            keep saved
          </Button>
        ) : null}
      </div>
    </div>
  );
}
