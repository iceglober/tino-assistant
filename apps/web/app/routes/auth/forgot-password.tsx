import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Notice } from "../../components/ui/Notice";
import { authClient, authErrorMessage } from "../../lib/auth";
import type { Route } from "./+types/forgot-password";

export const meta: Route.MetaFunction = () => [{ title: "reset your password · tino" }];

export async function clientAction({ request }: Route.ClientActionArgs) {
  const email = String((await request.formData()).get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: "enter a valid email address.", email };
  const { error } = await authClient().requestPasswordReset({
    email,
    redirectTo: `${window.location.origin}/reset-password`,
  });
  // Same answer whether or not the account exists; only rate limits and outages surface.
  if (error && (error.status === 429 || (error.status ?? 0) >= 500)) {
    return { ok: false as const, error: authErrorMessage(error), email };
  }
  return { ok: true as const, error: null, email };
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formMethod === "POST";

  if (actionData?.ok) {
    return (
      <div className="stack">
        <h1>check your inbox.</h1>
        <p className="lede">
          if there's an account for <strong>{actionData.email}</strong>, a reset link is on its way. it works once and
          expires soon.
        </p>
        <Link to="/signin">back to sign in</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>forgot your password?</h1>
        <p className="lede">we'll email you a link to choose a new one.</p>
      </div>
      <Form method="post" className="stack" noValidate>
        <Field label="email" error={actionData?.error}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            defaultValue={actionData?.email ?? params.get("email") ?? ""}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          send the link
        </Button>
      </Form>
      <p className="small muted">
        remembered it? <Link to="/signin">sign in</Link>
      </p>
    </div>
  );
}
