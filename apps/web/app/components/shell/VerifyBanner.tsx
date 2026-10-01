import type { Me } from "@tino/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { loadPlatform } from "../../lib/session";

/**
 * Shown while the account's email is unconfirmed — but only where the server
 * requires confirmation (production); locally, invites and joins work without it.
 */
export function VerifyBanner({ me }: { me: Me }) {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    if (me.account.emailVerified) return;
    let live = true;
    loadPlatform()
      .then((p) => live && setRequired(p.emailVerification))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [me.account.emailVerified]);

  if (me.account.emailVerified || !required) return null;
  return (
    <div className="banner" role="status">
      <span aria-hidden="true">!</span>
      <span>
        confirm <strong>{me.account.email}</strong> to create or join orgs.{" "}
        <Link to={`/verify-email?email=${encodeURIComponent(me.account.email)}`}>resend the link</Link>
      </span>
    </div>
  );
}
