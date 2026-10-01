import type { HTMLAttributes, ReactNode } from "react";

/** A raised panel. Use for grouped, interactive content — sections are the default grouping. */
export function Card({ flush, className, ...rest }: HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return <div className={["panel", flush && "panel--flush", className].filter(Boolean).join(" ")} {...rest} />;
}

/** A titled region separated by a rule and whitespace. */
export function Section({
  title,
  sub,
  actions,
  children,
  id,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className="section" id={id} aria-labelledby={headingId}>
      <div className="section__head">
        <h2 id={headingId}>{title}</h2>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {sub ? <p className="section__sub">{sub}</p> : null}
      {children}
    </section>
  );
}
