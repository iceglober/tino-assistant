import { useEffect, useState } from "react";
import { Link } from "react-router";
import { RouteError } from "../../../components/RouteError";
import { SaveBar } from "../../../components/settings/SaveBar";
import { SettingField } from "../../../components/settings/SettingField";
import { Step, Steps } from "../../../components/settings/Steps";
import { useReturnParams } from "../../../components/settings/useReturnParams";
import { useSettingsForm } from "../../../components/settings/useSettingsForm";
import { Badge, StatusBadge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { CopyField } from "../../../components/ui/CopyField";
import { Notice } from "../../../components/ui/Notice";
import { useToast } from "../../../components/ui/Toast";
import { useOrg, useRefreshOrg } from "../../../layouts/app-shell";
import { useSettings } from "../../../layouts/settings-layout";
import { orgApi } from "../../../lib/api";
import { errorMessage } from "../../../lib/format";
import { diffSettings, hasChanges, spec, specsFor } from "../../../lib/settings";
import { runSettingsAction } from "../../../lib/settings-action";
import type { Route } from "./+types/slack";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { setup: await orgApi(params.slug).slackSetup() };
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  return runSettingsAction(params.slug, request);
}

const KEYS = specsFor("slack").map((s) => s.key);

const INSTALL_ERRORS: Record<string, string> = {
  team_taken: "that Slack workspace is already connected to another tino org. each workspace can belong to one org.",
  other_team:
    "you installed into a different Slack workspace than the one this org is connected to. install into the original workspace, or ask support to move it.",
  session_mismatch: "the install was started in a different browser session. start it again from this page.",
  cancelled: "the install was cancelled in Slack — nothing changed.",
  no_bot_token:
    "Slack didn't hand back a bot token. check the app has a bot user (the manifest adds one), then try again.",
};

const MODES = [
  {
    value: "own",
    title: "our own Slack app",
    tag: "recommended",
    body: "a private app in your workspace. full Slack rate limits, your name and icon, and no dependency on tino's app.",
  },
  {
    value: "managed",
    title: "tino's shared app",
    tag: null,
    body: "quickest to start. Slack throttles apps that aren't in its Marketplace, so reading history is slow — fine for a trial.",
  },
  {
    value: "auto",
    title: "automatic",
    tag: null,
    body: "use our own app once it's set up; until then, tino's.",
  },
] as const;

function useInstall(slug: string) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const start = async () => {
    setBusy(true);
    try {
      const { url } = await orgApi(slug).slackInstall();
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      toast.err(errorMessage(err));
    }
  };
  return { busy, start };
}

export default function SlackSettings({ loaderData }: Route.ComponentProps) {
  const { setup } = loaderData;
  const { settings } = useSettings();
  const { slug, org } = useOrg();
  const refresh = useRefreshOrg();
  const form = useSettingsForm(settings, KEYS, "Slack settings");
  const install = useInstall(slug);
  const toast = useToast();
  const [returned, dismiss] = useReturnParams(["installed", "error"]);
  const [manifestOpen, setManifestOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: react once per return from Slack
  useEffect(() => {
    if (returned?.installed) {
      toast.ok("Slack installed — say hi to tino in Slack");
      void refresh();
    }
  }, [returned]);

  const savedMode = String(settings.values["slack.mode"] ?? "") || "auto";
  const mode = (form.value("slack.mode") as string) || savedMode;
  const modeDirty = mode !== savedMode;
  const usesOwn = !setup.managedAvailable || mode !== "managed";
  const allSaved = setup.saved.clientId && setup.saved.clientSecret && setup.saved.signingSecret;
  const credKeys = ["slack.clientId", "slack.clientSecret", "slack.signingSecret"];
  const credsDirty = hasChanges(diffSettings(settings, form.draft, credKeys));
  const manifest = JSON.stringify(setup.manifest, null, 2);

  return (
    <div className="stack-lg">
      <div className="row row--between">
        <h2>Slack app</h2>
        <StatusBadge
          ok={setup.installed}
          okText={`installed${org.status.slack.client === "platform" ? " · tino's app" : org.status.slack.client === "org" ? " · your app" : ""}`}
          offText="not installed"
          warn
        />
      </div>

      {returned?.installed ? (
        <Notice tone="ok" title="installed">
          <p>
            tino is in your Slack workspace
            {setup.teamId ? (
              <>
                {" "}
                (<span className="mono">{setup.teamId}</span>)
              </>
            ) : null}
            . DM it, or invite it to a channel with <code>/invite @tino</code>.
          </p>
          <button type="button" className="btn btn--link small" onClick={dismiss}>
            dismiss
          </button>
        </Notice>
      ) : returned?.error ? (
        <Notice tone="err" title="the install didn't finish">
          <p>{INSTALL_ERRORS[returned.error] ?? returned.error}</p>
          <button type="button" className="btn btn--link small" onClick={dismiss}>
            dismiss
          </button>
        </Notice>
      ) : null}

      <div className="prose">
        <p>
          tino lives in Slack through a Slack app. we recommend <strong>your own</strong>: Slack heavily rate-limits
          apps that aren't listed in its Marketplace, and a private app inside your own workspace isn't subject to that.
          it takes about three minutes — we generate the app for you.
        </p>
      </div>

      {setup.managedAvailable ? (
        <fieldset className="fieldset">
          <legend className="field__label">which Slack app tino uses</legend>
          <div className="choice-list">
            {MODES.map((m) => (
              <label key={m.value} className="choice">
                <input
                  type="radio"
                  name="slack-mode"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => form.set("slack.mode", m.value)}
                />
                <span className="choice__title">
                  {m.title} {m.tag ? <Badge tone="ok">{m.tag}</Badge> : null}
                  {savedMode === m.value ? <span className="muted small"> · current</span> : null}
                </span>
                <span className="choice__body">{m.body}</span>
              </label>
            ))}
          </div>
          {modeDirty ? (
            <div className="row" style={{ marginTop: "var(--s-3)" }}>
              <Button variant="primary" loading={form.saving} onClick={() => form.save()}>
                save choice
              </Button>
              <Button variant="ghost" onClick={() => form.set("slack.mode", undefined)}>
                cancel
              </Button>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {usesOwn ? (
        <Steps label="set up your own Slack app">
          <Step n={1} title="create the app from our manifest" done={setup.saved.clientId}>
            <p>
              Slack opens with everything filled in — name, permissions, the events URL and the redirect URL. pick your
              workspace, review, and click <em>Create</em>.
            </p>
            <div className="row">
              <a className="btn btn--primary" href={setup.createUrl} target="_blank" rel="noopener noreferrer">
                create the Slack app ↗
              </a>
              <Button variant="ghost" size="sm" aria-expanded={manifestOpen} onClick={() => setManifestOpen((v) => !v)}>
                {manifestOpen ? "hide" : "view"} the manifest
              </Button>
            </div>
            {manifestOpen ? (
              <div className="stack">
                <pre className="code-block">{manifest}</pre>
                <p className="small muted">already in the manifest — here in case you edit the app later:</p>
                <div className="kv">
                  <span>events URL</span>
                  <CopyField value={setup.eventsUrl} label="events URL" />
                  <span>redirect URL</span>
                  <CopyField value={setup.redirectUrl} label="redirect URL" />
                </div>
              </div>
            ) : null}
          </Step>

          <Step n={2} title="paste its credentials" done={allSaved}>
            <p>
              in your new app, open <em>Basic Information → App Credentials</em> and copy these three values.
            </p>
            <div>
              {credKeys.map((k) => {
                const s = spec(k);
                return s ? (
                  <SettingField
                    key={k}
                    spec={s}
                    value={form.value(k)}
                    isSet={form.isSet(k)}
                    onChange={(v) => form.set(k, v)}
                    hint={k === "slack.clientId" ? "looks like 1234567890.1234567890" : undefined}
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
              label="save credentials"
            />
          </Step>

          <Step
            n={3}
            title="install it to your workspace"
            done={setup.installed}
            aside={setup.installed && setup.teamId ? <span className="muted small mono"> {setup.teamId}</span> : null}
          >
            <p>
              {setup.installed
                ? "installed. reinstall if you've changed the app's permissions."
                : "Slack asks you to approve tino's permissions, then brings you back here."}
            </p>
            <div className="row">
              <Button
                variant={setup.installed ? "secondary" : "primary"}
                onClick={() => void install.start()}
                loading={install.busy}
                disabled={!allSaved}
              >
                {setup.installed ? "reinstall to Slack" : "install to Slack"}
              </Button>
              {!allSaved ? <span className="small muted">save all three credentials first.</span> : null}
            </div>
          </Step>

          <Step n={4} title="tell your team" done={setup.installed && org.connections.slack}>
            <p>
              anyone in the org can now DM tino in Slack. to let it read their own DMs and private channels, each person
              connects Slack on their <Link to={`/${slug}/connections`}>connections</Link> page.
            </p>
          </Step>
        </Steps>
      ) : (
        <div className="stack">
          <Notice tone="accent" title="using tino's shared app">
            <p>
              no setup beyond installing it. Slack limits how fast non-Marketplace apps can read history, so the
              knowledge base fills in slowly. switch to your own app any time.
            </p>
          </Notice>
          <div>
            <Button variant="primary" onClick={() => void install.start()} loading={install.busy}>
              {setup.installed ? "reinstall to Slack" : "install to Slack"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
