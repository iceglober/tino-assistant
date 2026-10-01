import { useState } from "react";
import { RouteError } from "../../../components/RouteError";
import { SaveBar } from "../../../components/settings/SaveBar";
import { SettingField } from "../../../components/settings/SettingField";
import { useSettingsForm } from "../../../components/settings/useSettingsForm";
import { StatusBadge } from "../../../components/ui/Badge";
import { Section } from "../../../components/ui/Card";
import { useOrg } from "../../../layouts/app-shell";
import { useSettings } from "../../../layouts/settings-layout";
import { providerSpecs, specsFor } from "../../../lib/settings";
import { runSettingsAction } from "../../../lib/settings-action";
import type { Route } from "./+types/model";

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  return runSettingsAction(params.slug, request);
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI", body: "GPT models. the same key also powers knowledge-base embeddings." },
  {
    value: "anthropic",
    label: "Anthropic",
    body: "Claude models. pair with an embeddings key for the knowledge base.",
  },
  { value: "azure", label: "Azure OpenAI", body: "OpenAI models in your own Azure tenant, through your deployments." },
] as const;

const KEYS = specsFor("model").map((s) => s.key);

export default function ModelSettings() {
  const { settings } = useSettings();
  const { org } = useOrg();
  const form = useSettingsForm(settings, KEYS, "model settings");
  const saved = String(settings.values["model.provider"] ?? "");
  const provider = (form.value("model.provider") as string | undefined) || saved;
  const [showOthers, setShowOthers] = useState(false);
  const fields = provider ? providerSpecs(provider) : [];
  const others = PROVIDERS.filter((p) => p.value !== provider).flatMap((p) =>
    providerSpecs(p.value).filter((s) => (s.secret ? settings.secrets[s.key] : settings.values[s.key] !== undefined)),
  );

  return (
    <div className="stack-lg">
      <div className="row row--between">
        <h2>model</h2>
        <StatusBadge ok={org.status.model} okText="connected" offText="not set up" warn />
      </div>
      <p className="prose">
        tino thinks with your own model account — you pay the provider directly, and your prompts go only there.
      </p>

      <fieldset className="fieldset">
        <legend className="field__label">provider</legend>
        <div className="choice-list">
          {PROVIDERS.map((p) => (
            <label key={p.value} className="choice">
              <input
                type="radio"
                name="provider"
                value={p.value}
                checked={provider === p.value}
                onChange={() => form.set("model.provider", p.value)}
              />
              <span className="choice__title">
                {p.label} {saved === p.value ? <span className="muted small">· current</span> : null}
              </span>
              <span className="choice__body">{p.body}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {fields.length ? (
        <Section title={`${PROVIDERS.find((p) => p.value === provider)?.label ?? provider} details`}>
          <div>
            {fields.map((s) => (
              <SettingField
                key={s.key}
                spec={s}
                value={form.value(s.key)}
                isSet={form.isSet(s.key)}
                onChange={(v) => form.set(s.key, v)}
                optional={!s.secret && !s.key.endsWith(".deployment") && !s.key.endsWith(".resourceName")}
                hint={
                  s.key.endsWith(".model") && s.placeholder
                    ? `leave empty for the default (${s.placeholder}).`
                    : s.key === "azure.resourceName"
                      ? "from your endpoint: https://<name>.openai.azure.com"
                      : s.key === "azure.deployment"
                        ? "the deployment name you created, not the base model id."
                        : undefined
                }
              />
            ))}
          </div>
        </Section>
      ) : null}

      {others.length ? (
        <p className="small muted">
          keys for other providers are still saved ({others.map((s) => s.label).join(", ")}).{" "}
          <button type="button" className="btn btn--link" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? "hide" : "show"}
          </button>
        </p>
      ) : null}
      {showOthers ? (
        <div>
          {others.map((s) => (
            <SettingField
              key={s.key}
              spec={s}
              value={form.value(s.key)}
              isSet={form.isSet(s.key)}
              onChange={(v) => form.set(s.key, v)}
            />
          ))}
        </div>
      ) : null}

      <SaveBar
        dirty={form.dirty}
        saving={form.saving}
        onSave={() => form.save()}
        onReset={form.reset}
        error={form.applyError}
        label="save and connect"
      />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
