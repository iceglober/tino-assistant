import type { JSX, ReactNode } from "react";

export interface Tab {
  id: string;
  label: string;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab-btn${t.id === active ? " active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  active,
  id,
  children,
}: {
  active: string;
  id: string;
  children: ReactNode;
}): JSX.Element | null {
  if (active !== id) return null;
  return <div className="tab-panel">{children}</div>;
}
