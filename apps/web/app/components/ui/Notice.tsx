import type { ReactNode } from "react";

type Tone = "info" | "ok" | "warn" | "err" | "accent";
const GLYPH: Record<Tone, string> = { info: "i", ok: "✓", warn: "!", err: "✕", accent: "→" };

/** An inline message. The glyph carries the tone for people who can't see the colour. */
export function Notice({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className={tone === "info" ? "notice" : `notice notice--${tone}`} role={role}>
      <span className="notice__glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      {title ? <div className="notice__title">{title}</div> : <div>{children}</div>}
      {title && children ? <div className="notice__body">{children}</div> : null}
    </div>
  );
}
