import { type JSX, useCallback, useEffect, useState } from "react";
import { PageShell } from "../components/PageShell.js";
import { useToast } from "../hooks/useToast.js";
import {
  type AccessPolicy,
  getAccessPolicy,
  inviteUser,
  listUsers,
  type ManagedUser,
  setAccessPolicy,
  updateUser,
} from "../lib/api.js";

/**
 * Admin-only user management: who can join, invitations, roles, suspension.
 * Suspending someone blocks them in Slack and the console and pauses their
 * knowledge-base indexing; nothing they've indexed is deleted.
 */
export function Users({ onBack, currentUserId }: { onBack: () => void; currentUserId: string }): JSX.Element {
  const toast = useToast();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [policy, setPolicy] = useState<AccessPolicy | null>(null);
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([listUsers(), getAccessPolicy()]);
      setUsers(u.items);
      setPolicy(p);
      setDomain(p.domain ?? "");
    } catch (err) {
      toast.show((err as Error).message, "err");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast.show(ok, "ok");
      await load();
    } catch (err) {
      toast.show((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const invite = (): Promise<void> =>
    act(async () => {
      await inviteUser(email.trim(), role);
      setEmail("");
    }, `invited ${email.trim()}`);

  return (
    <PageShell title="users" onBack={onBack}>
      <section className="kb-card">
        <h2 className="kb-h2">who can join</h2>
        <p className="kb-sub">applies to the console and to Slack. people join by signing in here or by DMing tino.</p>
        {policy ? (
          <div className="ws-invite">
            <select
              className="field-input"
              aria-label="join policy"
              value={policy.mode}
              onChange={(e) => setPolicy({ ...policy, mode: e.target.value as AccessPolicy["mode"] })}
            >
              <option value="org-domain">anyone with an email on my domain</option>
              <option value="invite-only">only people I invite</option>
            </select>
            {policy.mode === "org-domain" ? (
              <input
                className="field-input"
                aria-label="domain"
                placeholder="acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            ) : null}
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={() => void act(() => setAccessPolicy({ mode: policy.mode, domain }), "join policy saved")}
            >
              save
            </button>
          </div>
        ) : null}
      </section>

      <section className="kb-card">
        <h2 className="kb-h2">invite someone</h2>
        <p className="kb-sub">they're active the first time they sign in here or DM tino from Slack with this email.</p>
        <form
          className="ws-invite"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) void invite();
          }}
        >
          <input
            className="field-input"
            type="email"
            aria-label="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="field-input"
            aria-label="role"
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
            invite
          </button>
        </form>
      </section>

      <section className="kb-card">
        <h2 className="kb-h2">people</h2>
        {!users ? (
          <p className="kb-sub">loading…</p>
        ) : (
          users.map((u) => (
            <div className="ws-row" key={u.id}>
              <div className="ws-row__avatar">{(u.name ?? u.email).slice(0, 1)}</div>
              <div className="ws-row__m">
                <b>{u.name ?? u.email}</b>
                {u.id === currentUserId ? <span className="badge badge-neutral"> you</span> : null}
                <small>
                  {u.email} · {u.role}
                  {u.status !== "active" ? ` · ${u.status}` : ""}
                  {u.slackLinked ? " · in Slack" : ""}
                  {u.connections.length ? ` · connected: ${u.connections.join(", ")}` : ""}
                </small>
              </div>
              <div className="ws-row__actions">
                <button
                  className="btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => updateUser(u.id, { role: u.role === "admin" ? "member" : "admin" }),
                      `${u.email} is now ${u.role === "admin" ? "a member" : "an admin"}`,
                    )
                  }
                >
                  {u.role === "admin" ? "make member" : "make admin"}
                </button>
                {u.status === "suspended" ? (
                  <button
                    className="btn-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => updateUser(u.id, { status: "active" }), `${u.email} reactivated`)}
                  >
                    reactivate
                  </button>
                ) : u.id !== currentUserId ? (
                  <button
                    className="btn-danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => updateUser(u.id, { status: "suspended" }), `${u.email} suspended`)}
                  >
                    suspend
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>
    </PageShell>
  );
}
