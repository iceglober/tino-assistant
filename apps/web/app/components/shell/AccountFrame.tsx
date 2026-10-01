import type { Me } from "@tino/contracts";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { UserMenu } from "./UserMenu";
import { VerifyBanner } from "./VerifyBanner";

/** The plain frame for pages outside any org: /new, /orgs, /account. */
export function AccountFrame({ me, children }: { me: Me | null; children: ReactNode }) {
  return (
    <div className="frame">
      <a href="#main" className="skip-link">
        skip to content
      </a>
      <header className="frame__bar">
        <Link to="/" className="brand">
          <img src="/tino-logo.png" alt="" width={28} height={28} />
          <span>tino</span>
        </Link>
        {me ? <UserMenu me={me} /> : null}
      </header>
      {me ? <VerifyBanner me={me} /> : null}
      <main className="frame__main" id="main">
        {children}
      </main>
    </div>
  );
}
