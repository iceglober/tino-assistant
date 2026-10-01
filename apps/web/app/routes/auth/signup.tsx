import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { GoogleButton } from "../../components/GoogleButton";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Notice } from "../../components/ui/Notice";
import { usePlatform } from "../../layouts/auth-layout";
import { authClient, authErrorMessage } from "../../lib/auth";
import { homeFor, invalidateMe, loadMe, loadPlatform, safeNext } from "../../lib/session";
import type { Route } from "./+types/signup";

export const meta: Route.MetaFunction = () => [{ title: "create an account · tino" }];

const MIN_PASSWORD = 10;

/** Where to land after sign-up: the invited org, an explicit ?next, or home. */
function destination(params: URLSearchParams): string {
  const org = params.get("org");
  if (org && /^[a-z0-9-]+$/.test(org)) return `/${org}`;
  return safeNext(params.get("next")) ?? "/";
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const me = await loadMe().catch(() => null);
  if (me) {
    const params = new URL(request.url).searchParams;
    const dest = destination(params);
    throw redirect(dest === "/" ? homeFor(me) : dest);
  }
  return null;
}

type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const params = new URL(request.url).searchParams;
  const dest = destination(params);

  const errors: Errors = {};
  if (!name) errors.name = "what should tino call you?";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "enter a valid email address.";
  if (password.length < MIN_PASSWORD) errors.password = `use at least ${MIN_PASSWORD} characters.`;
  if (Object.keys(errors).length) return { errors, values: { name, email } };

  const { data, error } = await authClient().signUp.email({ name, email, password, callbackURL: dest });
  if (error) {
    const msg = authErrorMessage(error);
    return { errors: { [error.code === "USER_ALREADY_EXISTS" ? "email" : "form"]: msg } as Errors, values: { name, email } };
  }

  const platform = await loadPlatform();
  if (platform.emailVerification && !data?.user.emailVerified) {
    const q = new URLSearchParams({ email });
    if (dest !== "/") q.set("next", dest);
    return redirect(`/verify-email?${q.toString()}`);
  }
  invalidateMe();
  const me = await loadMe();
  return redirect(dest === "/" && me ? homeFor(me) : dest);
}

export default function SignUp({ actionData }: Route.ComponentProps) {
  const platform = usePlatform();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formMethod === "POST";
  const errors: Errors = actionData?.errors ?? {};
  const org = params.get("org");
  const email = actionData?.values.email ?? params.get("email") ?? "";
  const dest = destination(params);

  return (
    <div className="stack">
      <div>
        {org ? <p className="eyebrow">you're invited</p> : null}
        <h1>{org ? "join your team on tino." : "create your account."}</h1>
        <p className="lede">
          {org ? (
            <>
              make an account with <strong>{email || "your work email"}</strong> and you'll land in{" "}
              <strong>{org}</strong>.
            </>
          ) : (
            "one account works across every org you're part of."
          )}
        </p>
      </div>

      {platform.signups === "closed" && !org ? (
        <Notice tone="accent" title="tino is in private beta">
          <p>
            you can sign up and join an org you've been invited to. starting a new org needs a beta invite — ask the
            person who told you about tino.
          </p>
        </Notice>
      ) : null}

      {platform.signIn.google ? (
        <>
          <GoogleButton callbackURL={dest} label="sign up with Google" />
          <div className="divider">
            <span>or with email</span>
          </div>
        </>
      ) : null}

      <Form method="post" className="stack" noValidate>
        <Field label="your name" error={errors.name}>
          <Input
            name="name"
            autoComplete="name"
            required
            defaultValue={actionData?.values.name ?? ""}
            autoFocus
          />
        </Field>
        <Field
          label="work email"
          error={errors.email}
          hint={org ? "use the address your invite was sent to." : undefined}
        >
          <Input name="email" type="email" autoComplete="email" required defaultValue={email} />
        </Field>
        <Field label="password" error={errors.password} hint={`at least ${MIN_PASSWORD} characters.`}>
          <Input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} />
        </Field>
        {errors.form ? (
          <Notice tone="err" role="alert">
            {errors.form}
          </Notice>
        ) : null}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          create account
        </Button>
        {platform.emailVerification ? (
          <p className="small muted">we'll email you a link to confirm the address.</p>
        ) : null}
      </Form>

      <p className="small muted">
        already have one?{" "}
        <Link to={`/signin?${new URLSearchParams({ ...(email ? { email } : {}), ...(dest !== "/" ? { next: dest } : {}) }).toString()}`}>
          sign in
        </Link>
      </p>
    </div>
  );
}
