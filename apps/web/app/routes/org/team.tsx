import type { AccessPolicy, ManagedUser, Role } from "@tino/contracts";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { PageHeader } from "../../components/PageHeader";
import { RouteError } from "../../components/RouteError";
import { Avatar } from "../../components/shell/UserMenu";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Section } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { Input, Select } from "../../components/ui/Input";
import { type ActionResult, useFetcherToast } from "../../hooks/useFetcherToast";
import { useOrg } from "../../layouts/app-shell";
import { orgApi } from "../../lib/api";
import { emailDomain, errorMessage, fmtDate } from "../../lib/format";
import { requireAdmin } from "../../lib/session";
import type { Route } from "./+types/team";

export const meta: Route.MetaFunction = () => [{ title: "team · tino" }];

export async function clientLoader({ params, context }: Route.ClientLoaderArgs) {
  requireAdmin(context);
  const api = orgApi(params.slug);
  const [users, access] = await Promise.all([api.users(), api.access()]);
  return { users: users.items, access };
}

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResult> {
  const f = await request.formData();
  const intent = String(f.get("intent"));
  const api = orgApi(params.slug);
  const s = (k: string) => String(f.get(k) ?? "").trim();
  try {
    switch (intent) {
      case "invite": {
        const email = s("email");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return { ok: false, intent, error: "enter a valid email address." };
        await api.invite({ email, role: s("role") === "admin" ? "admin" : "member" });
        return { ok: true, intent, message: `invited ${email} — they'll get an email with a sign-up link` };
      }
      case "role": {
        const role = s("role") as Role;
        await api.patchUser(s("id"), { role });
        return { ok: true, intent, message: `${s("email")} is now ${role === "admin" ? "an admin" : "a member"}` };
      }
      case "status": {
        const status = s("status") === "suspended" ? "suspended" : "active";
        await api.patchUser(s("id"), { status });
        return { ok: true, intent, message: `${s("email")} ${status === "suspended" ? "suspended" : "reactivated"}` };
      }
      case "access": {
        const mode = s("mode") === "org-domain" ? "org-domain" : "invite-only";
        const domain = s("domain").replace(/^@/, "").toLowerCase();
        if (mode === "org-domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
          return { ok: false, intent, error: "enter your company's email domain, like acme.com." };
        }
        await api.saveAccess({ mode, domain: mode === "org-domain" ? domain : null });
        return { ok: true, intent, message: "join policy saved" };
      }
      default:
        return { ok: false, intent, error: "unknown action" };
    }
  } catch (err) {
    return { ok: false, intent, error: errorMessage(err) };
  }
}

function JoinPolicy({ policy, myEmail }: { policy: AccessPolicy; myEmail: string }) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher);
  const [mode, setMode] = useState(policy.mode);
  const [domain, setDomain] = useState(policy.domain ?? emailDomain(myEmail));
  const error = fetcher.data && !(fetcher.data as ActionResult).ok ? (fetcher.data as { error: string }).error : null;
  const dirty = mode !== policy.mode || (mode === "org-domain" && domain !== (policy.domain ?? ""));

  return (
    <fetcher.Form method="post" className="stack">
      <input type="hidden" name="intent" value="access" />
      <fieldset className="fieldset">
        <legend className="visually-hidden">who can join</legend>
        <div className="choice-list">
          <label className="choice">
            <input
              type="radio"
              name="mode"
              value="org-domain"
              checked={mode === "org-domain"}
              onChange={() => setMode("org-domain")}
            />
            <span className="choice__title">anyone with an email at my domain</span>
            <span className="choice__body">
              people with a verified address at your domain see this org and can join. good for a whole company.
            </span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="mode"
              value="invite-only"
              checked={mode === "invite-only"}
              onChange={() => setMode("invite-only")}
            />
            <span className="choice__title">only people I invite</span>
            <span className="choice__body">nobody gets in without an invite from an admin.</span>
          </label>
        </div>
      </fieldset>
      {mode === "org-domain" ? (
        <Field label="email domain" error={error} hint="applies here and in Slack.">
          <Input
            name="domain"
            mono
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
            spellCheck={false}
          />
        </Field>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={fetcher.state !== "idle"} disabled={!dirty}>
          save policy
        </Button>
      </div>
    </fetcher.Form>
  );
}

function Invite() {
  const fetcher = useFetcher();
  const form = useRef<HTMLFormElement>(null);
  useFetcherToast(fetcher);
  const result = fetcher.data as ActionResult | undefined;

  useEffect(() => {
    if (fetcher.state === "idle" && result?.ok) form.current?.reset();
  }, [fetcher.state, result]);

  return (
    <fetcher.Form method="post" ref={form} className="invite" noValidate>
      <input type="hidden" name="intent" value="invite" />
      <Field label="email" error={result && !result.ok ? result.error : null} className="grow">
        <Input name="email" type="email" placeholder="name@company.com" autoComplete="off" required />
      </Field>
      <Field label="role">
        <Select
          name="role"
          defaultValue="member"
          options={[
            { value: "member", label: "member" },
            { value: "admin", label: "admin" },
          ]}
        />
      </Field>
      <Button type="submit" variant="primary" loading={fetcher.state !== "idle"} className="invite__btn">
        send invite
      </Button>
    </fetcher.Form>
  );
}

function PersonRow({ user, isMe, onSuspend }: { user: ManagedUser; isMe: boolean; onSuspend: () => void }) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher);
  const busy = fetcher.state !== "idle";
  const flip = user.role === "admin" ? "member" : "admin";

  return (
    <tr className={user.status === "suspended" ? "is-off" : undefined}>
      <td>
        <div className="person">
          <Avatar name={user.name} email={user.email} size={32} />
          <div>
            <div className="person__name">
              {user.name ?? user.email.split("@")[0]} {isMe ? <Badge tone="outline">you</Badge> : null}
            </div>
            <div className="person__email">{user.email}</div>
          </div>
        </div>
      </td>
      <td>{user.role === "admin" ? <Badge tone="accent">admin</Badge> : <span className="muted">member</span>}</td>
      <td>
        {user.status === "active" ? (
          <span className="ok-text">✓ active</span>
        ) : user.status === "invited" ? (
          <Badge tone="warn">invited</Badge>
        ) : (
          <Badge tone="err">suspended</Badge>
        )}
      </td>
      <td className="small">
        {[user.slackLinked && "Slack", ...user.connections.filter((c) => c !== "slack")].filter(Boolean).join(", ") || (
          <span className="muted">—</span>
        )}
      </td>
      <td className="small muted">{fmtDate(user.createdAt)}</td>
      <td>
        {isMe ? null : (
          <div className="row row--end">
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="role" />
              <input type="hidden" name="id" value={user.id} />
              <input type="hidden" name="email" value={user.email} />
              <input type="hidden" name="role" value={flip} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                loading={busy && fetcher.formData?.get("intent") === "role"}
              >
                make {flip}
              </Button>
            </fetcher.Form>
            {user.status === "suspended" ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="status" />
                <input type="hidden" name="id" value={user.id} />
                <input type="hidden" name="email" value={user.email} />
                <input type="hidden" name="status" value="active" />
                <Button type="submit" size="sm" variant="ghost" loading={busy}>
                  reactivate
                </Button>
              </fetcher.Form>
            ) : (
              <Button size="sm" variant="danger" onClick={onSuspend}>
                suspend
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function Team({ loaderData }: Route.ComponentProps) {
  const { users, access } = loaderData;
  const { org, me } = useOrg();
  const [suspending, setSuspending] = useState<ManagedUser | null>(null);
  const suspender = useFetcher();
  useFetcherToast(suspender, () => setSuspending(null));
  const counts = {
    active: users.filter((u) => u.status === "active").length,
    invited: users.filter((u) => u.status === "invited").length,
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="team"
        lede="who's in this org. people sign in here or DM tino in Slack — both use the same membership."
      />

      <Section
        title="invite someone"
        sub="they get an email with a link to sign up. they're active the first time they sign in."
      >
        <Invite />
      </Section>

      <Section
        title="people"
        sub={`${counts.active} active${counts.invited ? `, ${counts.invited} invited` : ""}. suspending someone blocks them here and in Slack and pauses their indexing — nothing they've connected is deleted.`}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">person</th>
                <th scope="col">role</th>
                <th scope="col">status</th>
                <th scope="col">connected</th>
                <th scope="col">joined</th>
                <th scope="col">
                  <span className="visually-hidden">actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <PersonRow
                  key={u.id}
                  user={u}
                  isMe={u.id === org.me.id || u.email === me.account.email}
                  onSuspend={() => setSuspending(u)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="who can join">
        <JoinPolicy policy={access} myEmail={me.account.email} />
      </Section>

      <ConfirmDialog
        open={!!suspending}
        title={`suspend ${suspending?.name ?? suspending?.email ?? ""}?`}
        confirmLabel="suspend"
        destructive
        busy={suspender.state !== "idle"}
        onCancel={() => setSuspending(null)}
        onConfirm={() =>
          suspending &&
          suspender.submit(
            { intent: "status", id: suspending.id, email: suspending.email, status: "suspended" },
            { method: "post" },
          )
        }
      >
        <p>
          they can't use tino here or in Slack until you reactivate them. their knowledge-base indexing pauses; nothing
          is deleted.
        </p>
      </ConfirmDialog>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
