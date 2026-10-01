import type { ReactNode } from "react";

export function Spinner({ label }: { label?: string }) {
  if (!label) return <span className="spinner" aria-hidden="true" />;
  return (
    <span role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

/** A quiet inline loading line, for sections that load after the page. */
export function Loading({ children = "loading…" }: { children?: ReactNode }) {
  return (
    <div className="loading" role="status">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <span key={i} className="skeleton" style={{ width: `${90 - i * 17}%` }} />
      ))}
    </div>
  );
}
