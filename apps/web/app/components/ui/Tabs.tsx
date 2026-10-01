import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";

export interface TabLink {
  to: string;
  label: ReactNode;
  /** Match only this exact path (for index tabs). */
  end?: boolean;
}

/**
 * Route-backed tabs: each tab is a link, so the URL is the state and the back
 * button works. Search params (e.g. ?scope=) are carried across tabs.
 */
export function TabNav({ tabs, label, keepSearch = true }: { tabs: TabLink[]; label: string; keepSearch?: boolean }) {
  const { search } = useLocation();
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={keepSearch ? `${t.to}${search}` : t.to} end={t.end} className="tabs__tab" prefetch="intent">
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** A small segmented control for a two-to-four-way choice. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="seg__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
