import type { ReactNode } from "react";

/** A numbered setup walkthrough. Each step says whether it's done, in words and a glyph. */
export function Steps({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ol className="steps" aria-label={label}>
      {children}
    </ol>
  );
}

export function Step({
  n,
  title,
  done,
  children,
  aside,
}: {
  n: number;
  title: ReactNode;
  done?: boolean;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <li className={done ? "step is-done" : "step"}>
      <span className="step__mark" aria-hidden="true">
        {done ? "✓" : n}
      </span>
      <div className="step__body">
        <h3 className="step__title">
          {title}
          {done ? <span className="visually-hidden"> (done)</span> : null}
          {aside}
        </h3>
        <div className="step__content">{children}</div>
      </div>
    </li>
  );
}
