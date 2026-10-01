import { Link, redirect, useFetcher } from "react-router";
import { PrivateBeta } from "../components/PrivateBeta";
import { RouteError } from "../components/RouteError";
import { AccountFrame } from "../components/shell/AccountFrame";
import { Badge } from "../components/ui/Badge";
import { Button, ButtonLink } from "../components/ui/Button";
import { Section } from "../components/ui/Card";
import { Notice } from "../components/ui/Notice";
import { useSession } from "../layouts/signed-in";
import { accountApi } from "../lib/api";
import { errorMessage } from "../lib/format";
import { invalidateMe } from "../lib/session";
import type { Route } from "./+types/orgs";

export const meta: Route.MetaFunction = () => [{ title: "your orgs · tino" }];

export async function clientAction({ request }: Route.ClientActionArgs) {
  const slug = String((await request.formData()).get("slug") ?? "");
  try {
    await accountApi.join(slug);
    invalidateMe();
    return redirect(`/${slug}`);
  } catch (err) {
    return { slug, error: errorMessage(err) };
  }
}

function JoinButton({ slug, disabled }: { slug: string; disabled: boolean }) {
  const fetcher = useFetcher<typeof clientAction>();
  return (
    <fetcher.Form method="post" className="row">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" variant="primary" size="sm" loading={fetcher.state !== "idle"} disabled={disabled}>
        join
      </Button>
      {fetcher.data && "error" in fetcher.data ? (
        <span className="field__error" role="alert">
          {fetcher.data.error}
        </span>
      ) : null}
    </fetcher.Form>
  );
}

export default function Orgs() {
  const { me, platform } = useSession();
  const needsVerify = platform.emailVerification && !me.account.emailVerified;
  const nothing = me.memberships.length === 0 && me.joinable.length === 0;

  return (
    <AccountFrame me={me}>
      <div className="narrow stack-lg">
        <div className="row row--between">
          <h1>your orgs.</h1>
          {me.canCreateOrg ? (
            <ButtonLink to="/new" variant="secondary">
              create an org
            </ButtonLink>
          ) : null}
        </div>

        {nothing && !me.canCreateOrg ? <PrivateBeta me={me} /> : null}

        {me.memberships.length > 0 ? (
          <ul className="org-list" aria-label="orgs you belong to">
            {me.memberships.map((m) => (
              <li key={m.org.id} className="org-list__item">
                <span className="org-mark" aria-hidden="true">
                  {m.org.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="grow">
                  {m.status === "suspended" ? (
                    <span className="org-list__name">{m.org.name}</span>
                  ) : (
                    <Link to={`/${m.org.slug}`} className="org-list__name">
                      {m.org.name}
                    </Link>
                  )}
                  <span className="org-list__slug">/{m.org.slug}</span>
                </span>
                <span className="row">
                  {m.role === "admin" ? <Badge tone="accent">admin</Badge> : <Badge>member</Badge>}
                  {m.status === "invited" ? <Badge tone="warn">invited</Badge> : null}
                  {m.status === "suspended" ? <Badge tone="err">suspended</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : nothing && me.canCreateOrg ? (
          <div className="stack">
            <p className="lede">you're not in any org yet. create one for your team.</p>
            <ButtonLink to="/new" variant="primary" size="lg">
              create an org
            </ButtonLink>
          </div>
        ) : null}

        {me.joinable.length > 0 ? (
          <Section title="you can join" sub={`these orgs let in anyone with an email at your domain.`}>
            {needsVerify ? (
              <Notice tone="warn">
                confirm {me.account.email} first —{" "}
                <Link to={`/verify-email?email=${encodeURIComponent(me.account.email)}&next=/orgs`}>resend the link</Link>
              </Notice>
            ) : null}
            <ul className="org-list">
              {me.joinable.map((o) => (
                <li key={o.id} className="org-list__item">
                  <span className="org-mark org-mark--ghost" aria-hidden="true">
                    {o.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="grow">
                    <span className="org-list__name">{o.name}</span>
                    <span className="org-list__slug">/{o.slug}</span>
                  </span>
                  <JoinButton slug={o.slug} disabled={needsVerify} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </AccountFrame>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
