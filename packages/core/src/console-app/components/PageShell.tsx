import type { JSX, ReactNode } from "react";

/** The header + body frame shared by the secondary pages (tools, users). */
export function PageShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="kb-root">
      <header className="chat-header">
        <div className="logo-block">
          <img src="/assets/tino-logo.png" alt="tino" className="chat-logo" />
          <span className="logo-wordmark">tino</span>
          <span className="kb-title">{title}</span>
        </div>
        <div className="chat-header-actions">
          <button className="btn-ghost" type="button" onClick={onBack}>
            ← back to chat
          </button>
        </div>
      </header>
      <div className="kb-body">{children}</div>
    </div>
  );
}
