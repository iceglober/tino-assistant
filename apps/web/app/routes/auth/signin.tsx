import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { GoogleButton } from "../../components/GoogleButton";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Notice } from "../../components/ui/Notice";
import { usePlatform } from "../../layouts/auth-layout";
import { authClient, authErrorMessage } from "../../lib/auth";
import { homeFor, invalidateMe, loadMe, safeNext } from "../../lib/session";
import type { Route } from "./+types/signin";

export const meta: Route.MetaFunction = () => [{ title: "sign in · tino" }];

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const me = await loadMe().catch(() => null);
  if (me) throw redirect(safeNext(new URL(request.url).searchParams.get("next")) ?? homeFor(me));
  return null;
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(new URL(request.url).searchParams.get("next"));

  // No password needed: email a one-time link. Also how someone who has only
  // used tino in Slack gets into their account.
  if (form.get("intent") === "link") {
    if (!email) return { error: "enter your email and we'll send you a link.", email, code: "" };
    const { error } = await authClient().signIn.magicLink({ email, callbackURL: next ?? "/" });
    if (error) return { error: authErrorMessage(error), email, code: error.code ?? "" };
    return { error: null, email, code: "", linkSent: true };
  }

  if (!email || !password) return { error: "enter your email and password.", email, code: "" };

  const { error } = await authClient().signIn.email({ email, password });
  if (error) return { error: authErrorMessage(error), email, code: error.code ?? "" };

  invalidateMe();
  const me = await loadMe();
  return redirect(next ?? (me ? homeFor(me) : "/"));
}

export default function SignIn({ actionData }: Route.ComponentProps) {
  const platform = usePlatform();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formMethod === "POST";
  const next = safeNext(params.get("next"));
  const carry = new URLSearchParams();
  if (next) carry.set("next", next);
  const email = actionData?.email ?? params.get("email") ?? "";
  if (email) carry.set("email", email);
  const unverified = actionData?.code === "EMAIL_NOT_VERIFIED";
  const linkSent = !!(actionData && "linkSent" in actionData && actionData.linkSent);

  return (
    <div className="stack">
      <div>
        <h1>welcome back.</h1>
        <p className="lede">sign in to your tino account.</p>
      </div>

      {linkSent ? (
        <Notice tone="ok" title="check your inbox">
          <p>we sent a sign-in link to {actionData?.email}. it works once and expires in 15 minutes.</p>
        </Notice>
      ) : null}

      {params.get("reset") === "1" ? <Notice tone="ok">password changed — sign in with the new one.</Notice> : null}
      {params.get("verified") === "1" ? <Notice tone="ok">email confirmed. sign in to continue.</Notice> : null}

      {platform.signIn.google ? (
        <>
          <GoogleButton callbackURL={next ?? "/"} />
          <div className="divider">
            <span>or with email</span>
          </div>
        </>
      ) : null}

      <Form method="post" className="stack" noValidate>
        <Field label="email" error={actionData && !unverified ? actionData.error : null}>
          <Input name="email" type="email" autoComplete="email" required defaultValue={email} autoFocus={!email} />
        </Field>
        <Field
          label="password"
          hint={
            <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}>
              forgot your password?
            </Link>
          }
        >
          <Input name="password" type="password" autoComplete="current-password" required autoFocus={!!email} />
        </Field>
        {unverified ? (
          <Notice tone="warn" title="confirm your email first">
            <p>
              we sent a link to {actionData?.email}. <Link to={`/verify-email?${carry.toString()}`}>send it again</Link>
            </p>
          </Notice>
        ) : null}
        <Button type="submit" name="intent" value="password" variant="primary" size="lg" block loading={busy}>
          sign in
        </Button>
        <Button type="submit" name="intent" value="link" variant="ghost" block formNoValidate>
          email me a sign-in link instead
        </Button>
      </Form>

      <p className="small muted">
        new here? <Link to={`/signup?${carry.toString()}`}>create an account</Link>
      </p>
    </div>
  );
}
