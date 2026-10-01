import type { ReactNode } from "react";

export type Tone = "neutral" | "ok" | "warn" | "err" | "accent" | "outline";

export function Badge({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={tone === "neutral" ? "badge" : `badge badge--${tone}`}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A status word with a glyph, so meaning never rides on colour alone. */
export function StatusBadge({
  ok,
  okText = "on",
  offText = "off",
  warn,
}: {
  ok: boolean;
  okText?: string;
  offText?: string;
  /** When not ok, show as a warning rather than neutral. */
  warn?: boolean;
}) {
  return ok ? (
    <Badge tone="ok">✓ {okText}</Badge>
  ) : (
    <Badge tone={warn ? "warn" : "neutral"}>
      {warn ? "!" : "○"} {offText}
    </Badge>
  );
}
