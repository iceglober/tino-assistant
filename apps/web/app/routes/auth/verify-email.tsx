import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Notice } from "../../components/ui/Notice";
import { authClient, authErrorMessage } from "../../lib/auth";
import { homeFor, loadMe, safeNext } from "../../lib/session";
import type { Route } from "./+types/verify-email";

export const meta: Route.MetaFunction = () => [{ title: "check your inbox · tino" }];

export async function clientLoader() {
  return { me: await loadMe().catch(() => null) };
}

export default function VerifyEmail({ loaderData }: Route.ComponentProps) {
  const { me } = loaderData;
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState(params.get("email") ?? me?.account.email ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (me?.account.emailVerified) {
    return (
      <div className="stack">
        <h1>you're confirmed.</h1>
        <p className="lede">{me.account.email} is verified.</p>
        <ButtonLink to={next ?? homeFor(me)} variant="primary" size="lg">
          continue
        </ButtonLink>
      </div>
    );
  }

  const resend = async () => {
    if (!email.trim()) {
      setError("enter the email you signed up with.");
      return;
    }
    setError(null);
    setState("sending");
    const { error: err } = await authClient().sendVerificationEmail({ email: email.trim(), callbackURL: next ?? "/" });
    if (err) {
      setState("idle");
      setError(authErrorMessage(err));
    } else {
      setState("sent");
    }
  };

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">one more step</p>
        <h1>check your inbox.</h1>
        <p className="lede">
          we sent a link to {params.get("email") || me?.account.email ? <strong>{email}</strong> : "your email"}. open
          it to confirm the address — it expires in an hour.
        </p>
      </div>

      {state === "sent" ? (
        <Notice tone="ok" role="status">
          sent. give it a minute, and check spam if it doesn't show up.
        </Notice>
      ) : null}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void resend();
        }}
      >
        {params.get("email") || me ? null : (
          <Field label="email" error={error}>
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        {error && (params.get("email") || me) ? (
          <Notice tone="err" role="alert">
            {error}
          </Notice>
        ) : null}
        <div className="row">
          <Button type="submit" variant="secondary" loading={state === "sending"}>
            {state === "sent" ? "send it again" : "resend the link"}
          </Button>
          <Link to={`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="small">
            i've confirmed — sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
