import { useState } from "react";

/** A value to paste somewhere else (a redirect URL, a scope), with a copy button. */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="copy">
      <span className="copy__value">{value}</span>
      <button type="button" className="copy__btn" onClick={() => void copy()} aria-label={`copy ${label ?? value}`}>
        <span aria-live="polite">{copied ? "copied ✓" : "copy"}</span>
      </button>
    </div>
  );
}
