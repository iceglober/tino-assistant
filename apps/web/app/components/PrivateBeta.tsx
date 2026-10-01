import type { Me } from "@tino/contracts";
import { emailDomain } from "../lib/format";

/** For people who can't create an org during the closed beta and have nowhere to go yet. */
export function PrivateBeta({ me }: { me: Me }) {
  return (
    <div className="stack hero-empty">
      <p className="eyebrow">private beta</p>
      <h1>tino is invite-only for now.</h1>
      <p className="lede">
        ask your team's admin to invite <strong>{me.account.email}</strong>. once they do, the org shows up here and
        you can jump straight in.
      </p>
      <p className="prose small">
        if your company already uses tino and lets in anyone{" "}
        {emailDomain(me.account.email) ? <>at @{emailDomain(me.account.email)}</> : "on your domain"}, it'll appear
        here too{me.account.emailVerified ? "" : " once you've confirmed your email"}.
      </p>
    </div>
  );
}
