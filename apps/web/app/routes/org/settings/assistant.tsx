import { RouteError } from "../../../components/RouteError";
import { SaveBar } from "../../../components/settings/SaveBar";
import { useSettingsForm } from "../../../components/settings/useSettingsForm";
import { useSettings } from "../../../layouts/settings-layout";
import { runSettingsAction } from "../../../lib/settings-action";
import type { Route } from "./+types/assistant";

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  return runSettingsAction(params.slug, request);
}

const KEY = "slack.channelMentions";
const KEYS = [KEY];

const OPTIONS = [
  {
    value: "workspace",
    title: "only what the channel can see",
    tag: "recommended",
    body: "channel replies use public channels, the channel itself, the workspace knowledge base, and workspace tools marked usable in channels. in channels with people from outside the company, only the channel itself. for anything private, tino answers in the asker's DM.",
  },
  {
    value: "asker",
    title: "the asker's private context too",
    tag: null,
    body: "channel replies can draw on the asker's mail, calendar, DMs, private knowledge and personal tools. only an instruction to the model keeps private details out of a reply the whole channel reads — and anyone in the channel can post text that tries to override it.",
  },
] as const;

export default function AssistantSettings() {
  const { settings } = useSettings();
  const form = useSettingsForm(settings, KEYS, "assistant settings");
  const value = (form.value(KEY) as string) || "workspace";

  return (
    <div className="stack-lg">
      <h2>assistant</h2>
      <fieldset className="fieldset">
        <legend className="field__label">when someone @mentions tino in a channel, it may use</legend>
        <div className="choice-list">
          {OPTIONS.map((o) => (
            <label key={o.value} className="choice">
              <input
                type="radio"
                name="mentions"
                value={o.value}
                checked={value === o.value}
                onChange={() => form.set(KEY, o.value)}
              />
              <span className="choice__title">
                {o.title} {o.tag ? <span className="badge badge--ok">{o.tag}</span> : null}
              </span>
              <span className="choice__body">{o.body}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <SaveBar
        dirty={form.dirty}
        saving={form.saving}
        onSave={() => form.save()}
        onReset={form.reset}
        error={form.applyError}
      />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
