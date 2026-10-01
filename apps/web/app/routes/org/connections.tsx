import type { ConnectionProvider, GoogleAccess } from "@tino/contracts";
import { useEffect, useState } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import { PageHeader } from "../../components/PageHeader";
import { RouteError } from "../../components/RouteError";
import { StatusBadge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { Notice } from "../../components/ui/Notice";
import { useToast } from "../../components/ui/Toast";
import { type ActionResult, useFetcherToast } from "../../hooks/useFetcherToast";
import { useOrg } from "../../layouts/app-shell";
import { connectUrls, orgApi } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import { invalidateOverview } from "../../lib/session";
import type { Route } from "./+types/connections";

export const meta: Route.MetaFunction = () => [{ title: "connections · tino" }];

const NAMES: Record<ConnectionProvider, string> = { google: "Google", slack: "Slack" };

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResult> {
  const provider = String((await request.formData()).get("provider")) as ConnectionProvider;
  try {
    await orgApi(params.slug).disconnect(provider);
    invalidateOverview(params.slug);
    return { ok: true, message: `${NAMES[provider] ?? provider} disconnected` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Turn the ?connected= / ?error= the OAuth round-trip comes back with into a message, once. */
function useReturnFromProvider() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [result, setResult] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    if (connected) {
      const text =
        connected === "google"
          ? "Google connected — tino can now use your mail and calendar."
          : connected === "slack"
            ? "Slack connected — tino can now read your DMs and private channels when you ask."
            : `${connected} connected.`;
      setResult({ tone: "ok", text });
      toast.ok(text);
    } else if (error) {
      const text = error === "access_denied" ? "you cancelled the connection — nothing was changed." : error;
      setResult({ tone: "err", text });
    }
    setParams(
      (p) => {
        p.delete("connected");
        p.delete("error");
        return p;
      },
      { replace: true },
    );
  }, [params, setParams, toast]);

  return [result, () => setResult(null)] as const;
}

function Disconnect({ provider, consequence }: { provider: ConnectionProvider; consequence: string }) {
  const fetcher = useFetcher();
  const [confirming, setConfirming] = useState(false);
  useFetcherToast(fetcher, () => setConfirming(false));
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        disconnect
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`disconnect ${NAMES[provider]}?`}
        confirmLabel={`disconnect ${NAMES[provider]}`}
        destructive
        busy={fetcher.state !== "idle"}
        onCancel={() => setConfirming(false)}
        onConfirm={() => fetcher.submit({ provider }, { method: "post" })}
      >
        <p>{consequence}</p>
        <p>you can connect again any time.</p>
      </ConfirmDialog>
    </>
  );
}

export default function Connections() {
  const { org, slug, isAdmin } = useOrg();
  const { status, connections } = org;
  const [returned, dismiss] = useReturnFromProvider();
  const [access, setAccess] = useState<GoogleAccess>("mail");

  return (
    <div className="stack-lg">
      <PageHeader
        title="connections"
        lede="what tino may read on your behalf. these are yours alone — connecting doesn't give anyone else's tino access."
      />

      {returned ? (
        <Notice tone={returned.tone} title={returned.tone === "ok" ? "connected" : "that didn't work"}>
          <p>{returned.text}</p>
          <button type="button" className="btn btn--link small" onClick={dismiss}>
            dismiss
          </button>
        </Notice>
      ) : null}

      <section className="conn" aria-labelledby="conn-google">
        <div className="conn__head">
          <span className="conn__logo conn__logo--google" aria-hidden="true">
            G
          </span>
          <div className="grow">
            <h2 id="conn-google">Google</h2>
            <p className="muted small">Gmail and Google Calendar</p>
          </div>
          <StatusBadge
            ok={connections.google}
            okText="connected"
            offText={status.google.available ? "not connected" : "unavailable"}
          />
        </div>

        {!status.google.available ? (
          <Notice tone="warn" title="not available yet">
            <p>{status.google.reason ?? "this org hasn't set up a Google client."}</p>
            {isAdmin ? (
              <p>
                <Link to={`/${slug}/settings/google`}>set up Google →</Link>
              </p>
            ) : (
              <p>an admin needs to set it up.</p>
            )}
          </Notice>
        ) : (
          <div className="conn__body stack">
            <p className="prose">
              tino searches and reads your mail and checks your calendar when you ask it something — in Slack or here.
              it doesn't send mail unless you tell it to.
            </p>

            {status.google.pilot ? (
              <Notice tone="accent" title="heads-up: pilot client">
                <p>
                  Google will show a “Google hasn't verified this app” screen. that's expected while tino's client is in
                  pilot — choose <em>Advanced</em>, then <em>continue</em>.
                </p>
              </Notice>
            ) : null}

            <fieldset className="fieldset">
              <legend className="field__label">{connections.google ? "reconnect with" : "what tino may use"}</legend>
              <div className="choice-list">
                <label className="choice">
                  <input
                    type="radio"
                    name="access"
                    value="mail"
                    checked={access === "mail"}
                    onChange={() => setAccess("mail")}
                  />
                  <span className="choice__title">mail and calendar</span>
                  <span className="choice__body">the full assistant: inbox search, threads, and your schedule.</span>
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="access"
                    value="calendar"
                    checked={access === "calendar"}
                    onChange={() => setAccess("calendar")}
                  />
                  <span className="choice__title">calendar only</span>
                  <span className="choice__body">scheduling help without tino reading your mail.</span>
                </label>
              </div>
            </fieldset>

            <div className="row">
              <a className="btn btn--primary" href={connectUrls.google(slug, access)}>
                {connections.google ? "reconnect Google" : "connect Google"}
              </a>
              {connections.google ? (
                <Disconnect
                  provider="google"
                  consequence="tino forgets your Google token and stops reading your mail and calendar right away."
                />
              ) : null}
            </div>
            <p className="small muted">you'll go to Google to approve, then come straight back here.</p>
          </div>
        )}
      </section>

      <section className="conn" aria-labelledby="conn-slack">
        <div className="conn__head">
          <span className="conn__logo conn__logo--slack" aria-hidden="true">
            #
          </span>
          <div className="grow">
            <h2 id="conn-slack">Slack</h2>
            <p className="muted small">your DMs and private channels</p>
          </div>
          <StatusBadge
            ok={connections.slack}
            okText="connected"
            offText={status.slack.installed ? "not connected" : "unavailable"}
          />
        </div>

        {!status.slack.installed ? (
          <Notice tone="warn" title="the Slack app isn't installed yet">
            {isAdmin ? (
              <p>
                <Link to={`/${slug}/settings/slack`}>install it →</Link>
              </p>
            ) : (
              <p>an admin needs to install it first.</p>
            )}
          </Notice>
        ) : (
          <div className="conn__body stack">
            <p className="prose">
              tino can already see public channels it's in. connecting lets it search your DMs and private channels when{" "}
              <em>you</em> ask — never for anyone else.
            </p>
            <div className="row">
              {connections.slack ? (
                <Disconnect
                  provider="slack"
                  consequence="tino forgets your Slack token and stops reading your DMs and private channels."
                />
              ) : (
                <a className="btn btn--primary" href={connectUrls.slack(slug)}>
                  connect Slack
                </a>
              )}
            </div>
            {!connections.slack ? <p className="small muted">tip: you can also DM tino “connect” in Slack.</p> : null}
          </div>
        )}
      </section>

      <section className="conn" aria-labelledby="conn-tools">
        <div className="conn__head">
          <span className="conn__logo" aria-hidden="true">
            ⌘
          </span>
          <div className="grow">
            <h2 id="conn-tools">tools</h2>
            <p className="muted small">MCP servers — Linear, GitHub, your own APIs</p>
          </div>
          <span className="small muted">
            {connections.mcpServers ? `${connections.mcpServers} yours` : "none yours"}
          </span>
        </div>
        <div className="conn__body">
          <Link to={`/${slug}/tools`}>manage tools →</Link>
        </div>
      </section>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
