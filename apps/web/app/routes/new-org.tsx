import type { SlugAvailability } from "@tino/contracts";
import { useEffect, useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { PrivateBeta } from "../components/PrivateBeta";
import { RouteError } from "../components/RouteError";
import { AccountFrame } from "../components/shell/AccountFrame";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { useSession } from "../layouts/signed-in";
import { accountApi } from "../lib/api";
import { errorMessage, slugify } from "../lib/format";
import { invalidateMe } from "../lib/session";
import type { Route } from "./+types/new-org";

export const meta: Route.MetaFunction = () => [{ title: "create an org · tino" }];

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim();
  if (!name) return { field: "name" as const, error: "give your org a name." };
  try {
    const org = await accountApi.createOrg({ name, slug: slug || undefined });
    invalidateMe();
    return redirect(`/${org.slug}`);
  } catch (err) {
    return { field: "form" as const, error: errorMessage(err) };
  }
}

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "done"; result: SlugAvailability }
  | { state: "error" };

function useSlugCheck(slug: string): Check {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  useEffect(() => {
    if (!slug) {
      setCheck({ state: "idle" });
      return;
    }
    setCheck({ state: "checking" });
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      accountApi
        .slugAvailable(slug, ctrl.signal)
        .then((result) => setCheck({ state: "done", result }))
        .catch((err: Error) => {
          if (err.name !== "AbortError") setCheck({ state: "error" });
        });
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [slug]);
  return check;
}

export default function NewOrg({ actionData }: Route.ComponentProps) {
  const { me, platform } = useSession();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formMethod === "POST";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const effectiveSlug = slugTouched ? slug : slugify(name);
  const check = useSlugCheck(effectiveSlug);
  const host = (() => {
    try {
      return new URL(platform.baseUrl).host;
    } catch {
      return "tino";
    }
  })();

  const hasSomewhere = me.memberships.length > 0 || me.joinable.length > 0;
  if (!me.canCreateOrg) {
    return (
      <AccountFrame me={me}>
        <PrivateBeta me={me} />
        {hasSomewhere ? (
          <p className="small" style={{ marginTop: "var(--s-5)" }}>
            <Link to="/orgs">see the orgs you can open or join →</Link>
          </p>
        ) : null}
      </AccountFrame>
    );
  }

  const needsVerify = platform.emailVerification && !me.account.emailVerified;
  const taken = check.state === "done" && !check.result.available;
  const slugHint =
    check.state === "checking" ? (
      "checking…"
    ) : check.state === "done" && check.result.available ? (
      <span className="ok-text">
        ✓ {host}/{check.result.slug} is yours
      </span>
    ) : check.state === "error" ? (
      "couldn't check right now — you can still try."
    ) : (
      `your org's address: ${host}/${effectiveSlug || "…"}`
    );

  return (
    <AccountFrame me={me}>
      <div className="narrow stack-lg">
        <div className="stack">
          <p className="eyebrow">new org</p>
          <h1>set up tino for your team.</h1>
          <p className="lede">
            an org is one company or team. you'll be its admin: you connect Slack and Google, pick the model, and invite
            people.
          </p>
        </div>

        {needsVerify ? (
          <Notice tone="warn" title="confirm your email first">
            <p>
              open the link we sent to {me.account.email}.{" "}
              <Link to={`/verify-email?email=${encodeURIComponent(me.account.email)}&next=/new`}>resend it</Link>
            </p>
          </Notice>
        ) : null}

        <Form method="post" className="stack" noValidate>
          <Field label="org name" error={actionData?.field === "name" ? actionData.error : null}>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme"
              autoComplete="organization"
              autoFocus
              required
            />
          </Field>
          <Field
            label="web address"
            hint={slugHint}
            error={
              taken && check.state === "done" ? (check.result.problem ?? "that address is taken — try another.") : null
            }
          >
            <Input
              name="slug"
              mono
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value, 40));
              }}
              placeholder="acme"
              spellCheck={false}
              autoCapitalize="none"
            />
          </Field>
          {actionData?.field === "form" ? (
            <Notice tone="err" role="alert">
              {actionData.error}
            </Notice>
          ) : null}
          <div className="row">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={busy}
              disabled={needsVerify || !name.trim() || taken}
            >
              create org
            </Button>
            {hasSomewhere ? (
              <Link to="/orgs" className="small">
                or open an existing one
              </Link>
            ) : null}
          </div>
        </Form>
      </div>
    </AccountFrame>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
