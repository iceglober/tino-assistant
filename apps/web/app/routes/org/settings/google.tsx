import type { ResolutionView } from "@tino/contracts";
import { Link } from "react-router";
import { RouteError } from "../../../components/RouteError";
import { SaveBar } from "../../../components/settings/SaveBar";
import { SettingField } from "../../../components/settings/SettingField";
import { Step, Steps } from "../../../components/settings/Steps";
import { useSettingsForm } from "../../../components/settings/useSettingsForm";
import { Badge, StatusBadge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { CopyField } from "../../../components/ui/CopyField";
import { Notice } from "../../../components/ui/Notice";
import { useOrg } from "../../../layouts/app-shell";
import { useSettings } from "../../../layouts/settings-layout";
import { orgApi } from "../../../lib/api";
import { diffSettings, hasChanges, spec, specsFor } from "../../../lib/settings";
import { runSettingsAction } from "../../../lib/settings-action";
import type { Route } from "./+types/google";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { setup: await orgApi(params.slug).googleSetup() };
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  return runSettingsAction(params.slug, request);
}

const KEYS = specsFor("google").map((s) => s.key);
const CRED_KEYS = ["google.oauth.clientId", "google.oauth.clientSecret"];
const CONSOLE = "https://console.cloud.google.com";

function Resolution({ label, r }: { label: string; r: ResolutionView }) {
  return (
    <div className="resolution__row">
      <span className="resolution__label">{label}</span>
      {r.ok ? (
        <span>
          <span className="ok-text">✓ works</span> — through {r.client === "org" ? "your own client" : "tino's client"}
          {r.pilot ? (
            <>
              {" "}
              <Badge tone="warn">pilot</Badge>
            </>
          ) : null}
        </span>
      ) : (
        <span>
          <span className="err-text">✕ not yet</span> — {r.message}
        </span>
      )}
    </div>
  );
}

export default function GoogleSettings({ loaderData }: Route.ComponentProps) {
  const { setup } = loaderData;
  const { settings, platform } = useSettings();
  const { org } = useOrg();
  const form = useSettingsForm(settings, KEYS, "Google settings");
  const managed = platform.managed.google;
  const managedAvailable = managed.gmail || managed.calendar;
  const savedMode = String(settings.values["google.oauth.mode"] ?? "") || "auto";
  const mode = (form.value("google.oauth.mode") as string) || savedMode;
  const usesOwn = !managedAvailable || mode !== "managed";
  const saved = setup.saved.clientId && setup.saved.clientSecret;
  const credsDirty = hasChanges(diffSettings(settings, form.draft, CRED_KEYS));
  const ownWorks = setup.resolution.mail.ok && setup.resolution.mail.client === "org";

  const modes = [
    {
      value: "own",
      title: "our own Google client",
      tag: "recommended",
      body: "an internal OAuth client in your Google Workspace. no Google review, no warning screens, no seat limits.",
    },
    {
      value: "managed",
      title: "tino's Google client",
      tag: managed.pilot ? "pilot" : null,
      body: managed.pilot
        ? "no setup — but it's in pilot: people see Google's “unverified app” screen, and seats are limited."
        : `no setup. covers ${[managed.gmail && "mail", managed.calendar && "calendar"].filter(Boolean).join(" and ")}.`,
    },
    { value: "auto", title: "automatic", tag: null, body: "our own client once it's set up; until then, tino's." },
  ];

  return (
    <div className="stack-lg">
      <div className="row row--between">
        <h2>Google client</h2>
        <StatusBadge
          ok={org.status.google.available}
          okText={
            org.status.google.client === "org"
              ? "your client"
              : org.status.google.client === "platform"
                ? "tino's client"
                : "available"
          }
          offText="not set up"
          warn
        />
      </div>

      <div className="prose">
        <p>
          to read Gmail, an app needs Google's <em>restricted</em> scopes — and a public app using them must pass a paid
          security assessment (CASA) every year. an OAuth client that lives{" "}
          <strong>inside your own Google Workspace</strong>, with its consent screen set to <strong>Internal</strong>,
          skips all of that: only people in your Workspace can use it, and Google doesn't review it.
        </p>
        <p>it takes about five minutes, by someone allowed to create Google Cloud projects in your Workspace.</p>
      </div>

      <section className="resolution" aria-label="what new connections use right now">
        <p className="eyebrow">right now, a new connection would use</p>
        <Resolution label="mail + calendar" r={setup.resolution.mail} />
        <Resolution label="calendar only" r={setup.resolution.calendar} />
      </section>

      {managedAvailable ? (
        <fieldset className="fieldset">
          <legend className="field__label">which Google client tino uses</legend>
          <div className="choice-list">
            {modes.map((m) => (
              <label key={m.value} className="choice">
                <input
                  type="radio"
                  name="google-mode"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => form.set("google.oauth.mode", m.value)}
                />
                <span className="choice__title">
                  {m.title} {m.tag ? <Badge tone={m.tag === "pilot" ? "warn" : "ok"}>{m.tag}</Badge> : null}
                  {savedMode === m.value ? <span className="muted small"> · current</span> : null}
                </span>
                <span className="choice__body">{m.body}</span>
              </label>
            ))}
          </div>
          {mode !== savedMode ? (
            <div className="row" style={{ marginTop: "var(--s-3)" }}>
              <Button variant="primary" loading={form.saving} onClick={() => form.save()}>
                save choice
              </Button>
              <Button variant="ghost" onClick={() => form.set("google.oauth.mode", undefined)}>
                cancel
              </Button>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {usesOwn ? (
        <Steps label="set up your own Google client">
          <Step n={1} title="create a Google Cloud project" done={saved}>
            <p>
              make it under your Workspace organization (the “location” field), so it can be Internal. an existing
              project works too.
            </p>
            <a
              className="btn btn--secondary btn--sm"
              href={`${CONSOLE}/projectcreate`}
              target="_blank"
              rel="noopener noreferrer"
            >
              new project ↗
            </a>
          </Step>

          <Step n={2} title="turn on the Gmail and Calendar APIs" done={saved}>
            <p>in that project, enable both:</p>
            <div className="row">
              <a
                className="btn btn--secondary btn--sm"
                href={`${CONSOLE}/apis/library/gmail.googleapis.com`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Gmail API ↗
              </a>
              <a
                className="btn btn--secondary btn--sm"
                href={`${CONSOLE}/apis/library/calendar-json.googleapis.com`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Calendar API ↗
              </a>
            </div>
          </Step>

          <Step
            n={3}
            title={
              <>
                set up the consent screen as <em>Internal</em>
              </>
            }
            done={saved}
          >
            <p>
              in <em>Google Auth Platform</em>, fill in the app name (“tino” is fine) and a support email, and choose{" "}
              <strong>Audience: Internal</strong>. that's what keeps Google's review out of the picture.
            </p>
            <a
              className="btn btn--secondary btn--sm"
              href={`${CONSOLE}/auth/overview`}
              target="_blank"
              rel="noopener noreferrer"
            >
              consent screen ↗
            </a>
            <details className="details">
              <summary>scopes tino asks for</summary>
              <p className="small muted">internal apps don't need them listed, but here they are for your records:</p>
              <ul className="plain-list mono small">
                {setup.scopes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          </Step>

          <Step n={4} title="create the OAuth client" done={saved}>
            <p>
              choose <strong>Web application</strong>, and add this as an <em>Authorized redirect URI</em>:
            </p>
            <CopyField value={setup.redirectUrl} label="redirect URI" />
            <a
              className="btn btn--secondary btn--sm"
              href={`${CONSOLE}/auth/clients/create`}
              target="_blank"
              rel="noopener noreferrer"
            >
              create client ↗
            </a>
          </Step>

          <Step n={5} title="paste the client ID and secret" done={saved}>
            <div>
              {CRED_KEYS.map((k) => {
                const s = spec(k);
                return s ? (
                  <SettingField
                    key={k}
                    spec={s}
                    value={form.value(k)}
                    isSet={form.isSet(k)}
                    onChange={(v) => form.set(k, v)}
                    hint={k === "google.oauth.clientId" ? "ends in .apps.googleusercontent.com" : undefined}
                  />
                ) : null;
              })}
            </div>
            <SaveBar
              dirty={credsDirty}
              saving={form.saving}
              onSave={() => form.save()}
              onReset={form.reset}
              error={form.applyError}
              label="save client"
            />
          </Step>

          <Step n={6} title="people connect their own Google" done={ownWorks && org.connections.google}>
            <p>
              {ownWorks
                ? "your client is live. each person connects on their connections page — they'll see your app's name, with no warning screen."
                : "once the client above works, each person connects their own Google on the connections page."}{" "}
              <Link to={`/${org.org.slug}/connections`}>connections →</Link>
            </p>
          </Step>
        </Steps>
      ) : (
        <Notice tone={managed.pilot ? "warn" : "accent"} title="using tino's Google client">
          <p>
            people connect on their connections page with no setup here.
            {managed.pilot
              ? " during the pilot, Google shows an “unverified app” screen (they choose Advanced → continue), and the number of people who can connect is limited."
              : ""}
          </p>
        </Notice>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
