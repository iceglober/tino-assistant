import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Notice } from "../../components/ui/Notice";
import { authClient, authErrorMessage } from "../../lib/auth";
import type { Route } from "./+types/reset-password";

export const meta: Route.MetaFunction = () => [{ title: "choose a new password · tino" }];

const MIN_PASSWORD = 10;

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < MIN_PASSWORD) return { field: "password" as const, error: `use at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { field: "confirm" as const, error: "the two passwords don't match." };
  const { error } = await authClient().resetPassword({ newPassword: password, token });
  if (error) return { field: "form" as const, error: authErrorMessage(error) };
  return redirect("/signin?reset=1");
}

export default function ResetPassword({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formMethod === "POST";
  const token = params.get("token");

  if (!token || params.get("error")) {
    return (
      <div className="stack">
        <h1>this link doesn't work.</h1>
        <p className="lede">reset links work once and expire after a while. ask for a fresh one.</p>
        <ButtonLink to="/forgot-password" variant="primary">
          send a new link
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>choose a new password.</h1>
        <p className="lede">at least {MIN_PASSWORD} characters. you'll sign in with it next.</p>
      </div>
      <Form method="post" className="stack" noValidate>
        <Field label="new password" error={actionData?.field === "password" ? actionData.error : null}>
          <Input name="password" type="password" autoComplete="new-password" required autoFocus />
        </Field>
        <Field label="type it again" error={actionData?.field === "confirm" ? actionData.error : null}>
          <Input name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        {actionData?.field === "form" ? (
          <Notice tone="err" role="alert">
            {actionData.error} <Link to="/forgot-password">get a new link</Link>
          </Notice>
        ) : null}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          save password
        </Button>
      </Form>
    </div>
  );
}
