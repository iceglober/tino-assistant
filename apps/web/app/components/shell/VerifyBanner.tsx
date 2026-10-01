import type { Me } from "@tino/contracts";
import { Link } from "react-router";

/** Shown while the account's email is unconfirmed: invites and domain joins need it. */
export function VerifyBanner({ me }: { me: Me }) {
  if (me.account.emailVerified) return null;
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
