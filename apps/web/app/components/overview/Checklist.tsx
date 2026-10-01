import type { ReactNode } from "react";
import { Link } from "react-router";

export interface ChecklistItem {
  key: string;
  title: string;
  done: boolean;
  /** One line on the current state. */
  detail: ReactNode;
  to: string;
  action: string;
  /** Done, but with a caveat worth seeing (e.g. a pilot client). */
  caveat?: ReactNode;
}

/**
 * The setup ledger: numbered steps on a rail, each saying what's true now and
 * the one link that changes it. Done steps get a check *and* the word "done".
 */
export function Checklist({ items, label }: { items: ChecklistItem[]; label: string }) {
  const firstOpen = items.findIndex((i) => !i.done);
  return (
    <ol className="ledger" aria-label={label}>
      {items.map((item, i) => (
        <li
          key={item.key}
          className={["ledger__item", item.done && "is-done", i === firstOpen && "is-next"].filter(Boolean).join(" ")}
        >
          <span className="ledger__mark" aria-hidden="true">
            {item.done ? "✓" : i + 1}
          </span>
          <div className="ledger__body">
            <div className="ledger__title">
              <h3>{item.title}</h3>
              <span className={item.done ? "ledger__state ok-text" : "ledger__state"}>
                {item.done ? "done" : i === firstOpen ? "next up" : "to do"}
              </span>
            </div>
            <p className="ledger__detail">{item.detail}</p>
            {item.caveat ? <p className="ledger__caveat">{item.caveat}</p> : null}
          </div>
          <Link to={item.to} className={i === firstOpen ? "btn btn--primary btn--sm" : "btn btn--ghost btn--sm"}>
            {item.action}
          </Link>
        </li>
      ))}
    </ol>
  );
}
