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
 * button works. The search params named in `keep` (e.g. scope) carry across.
 */
export function TabNav({ tabs, label, keep = [] }: { tabs: TabLink[]; label: string; keep?: string[] }) {
  const { search } = useLocation();
  const current = new URLSearchParams(search);
  const carried = new URLSearchParams();
  for (const k of keep) {
    const v = current.get(k);
    if (v) carried.set(k, v);
  }
  const suffix = carried.size ? `?${carried.toString()}` : "";
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={`${t.to}${suffix}`} end={t.end} className="tabs__tab" prefetch="intent">
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
    <fieldset className="seg">
      <legend className="visually-hidden">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className="seg__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
