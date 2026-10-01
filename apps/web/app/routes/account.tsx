import { Link, useNavigate } from "react-router";
import { RouteError } from "../components/RouteError";
import { AccountFrame } from "../components/shell/AccountFrame";
import { Avatar } from "../components/shell/UserMenu";
import { Badge } from "../components/ui/Badge";
import { Button, ButtonLink } from "../components/ui/Button";
import { Section } from "../components/ui/Card";
import { useSession } from "../layouts/signed-in";
import { signOut } from "../lib/auth";
import type { Route } from "./+types/account";

export const meta: Route.MetaFunction = () => [{ title: "your account · tino" }];

export default function Account() {
  const { me } = useSession();
  const navigate = useNavigate();
  const { account } = me;

  return (
    <AccountFrame me={me}>
      <div className="narrow stack-lg">
        <div className="row">
          <Avatar name={account.name} email={account.email} size={48} />
          <div>
            <h1>{account.name ?? account.email}</h1>
            <p className="muted">
              {account.email}{" "}
              {account.emailVerified ? <Badge tone="ok">✓ confirmed</Badge> : <Badge tone="warn">! unconfirmed</Badge>}
            </p>
          </div>
        </div>

        <Section
          title="sign-in"
          sub="your account is how you sign in to tino. it doesn't give tino access to anything."
        >
          <div className="row">
            <ButtonLink to={`/forgot-password?email=${encodeURIComponent(account.email)}`} variant="secondary">
              change password
            </ButtonLink>
            {!account.emailVerified ? (
              <ButtonLink to={`/verify-email?email=${encodeURIComponent(account.email)}`} variant="ghost">
                resend confirmation
              </ButtonLink>
            ) : null}
          </div>
        </Section>

        <Section
          title="orgs"
          sub="mail, calendar and Slack are connected per org, from each org's connections page."
          actions={
            <ButtonLink to="/orgs" variant="ghost" size="sm">
              manage
            </ButtonLink>
          }
        >
          {me.memberships.length ? (
            <ul className="plain-list">
              {me.memberships.map((m) => (
                <li key={m.org.id}>
                  <Link to={`/${m.org.slug}/connections`}>{m.org.name}</Link>{" "}
                  <span className="muted small">· {m.role}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">none yet.</p>
          )}
        </Section>

        <Section title="sign out">
          <Button
            variant="danger"
            onClick={async () => {
              await signOut();
              navigate("/signin");
            }}
          >
            sign out of tino
          </Button>
        </Section>
      </div>
    </AccountFrame>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
