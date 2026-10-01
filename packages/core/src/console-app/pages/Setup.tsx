import { type JSX, useEffect, useState } from "react";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useToast } from "../hooks/useToast.js";
import { getConfig, putConfig, reloadAuth, reloadSlack } from "../lib/api.js";

/**
 * One-screen setup (admins only): Slack tokens, the model provider + model, and
 * (optionally) the Google OAuth client used for sign-in and Gmail/Calendar. Writes the exact config keys the backend reads, then hot-reloads
 * Slack (which also rebuilds the model) so edits take effect without a restart.
 */

interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  secret?: boolean;
  optional?: boolean;
}

const PROVIDERS: Record<string, { label: string; note?: string; fields: ProviderField[] }> = {
  azure: {
    label: "Azure OpenAI",
    fields: [
      { key: "azure.apiKey", label: "API Key", secret: true, placeholder: "your Azure OpenAI key" },
      { key: "azure.resourceName", label: "Resource Name", placeholder: "my-openai-resource", hint: "From your endpoint: https://<name>.openai.azure.com" },
      { key: "azure.deployment", label: "Deployment (model)", placeholder: "gpt-4o", hint: "The deployment name you created, not the base model id." },
      { key: "azure.apiVersion", label: "API Version", placeholder: "leave blank for the default", optional: true },
    ],
  },
  openai: {
    label: "OpenAI",
    fields: [
      { key: "openai.apiKey", label: "API Key", secret: true, placeholder: "sk-…" },
      { key: "openai.model", label: "Model", placeholder: "gpt-4o" },
    ],
  },
  anthropic: {
    label: "Anthropic",
    fields: [
      { key: "anthropic.apiKey", label: "API Key", secret: true, placeholder: "sk-ant-…" },
      { key: "anthropic.model", label: "Model", placeholder: "claude-sonnet-4-5" },
    ],
  },
};
const PROVIDER_IDS = Object.keys(PROVIDERS);
/** Mirrors CHANNEL_MENTION_POLICY_KEY in domain/types.ts. */
const MENTIONS_KEY = "slack.channelMentions";

const SLACK_FIELDS: ProviderField[] = [
  { key: "slack.botToken", label: "Bot Token", secret: true, placeholder: "xoxb-…", hint: "Slack → your app → OAuth & Permissions → Bot User OAuth Token" },
  { key: "slack.appToken", label: "App Token", secret: true, placeholder: "xapp-…", hint: "Slack → your app → Basic Information → App-Level Tokens (connections:write)" },
  { key: "slack.clientId", label: "OAuth Client ID", placeholder: "1234.5678", optional: true, hint: "For per-user connect: Basic Information → App Credentials. Add redirect URL <your-url>/api/oauth/slack/callback + User Token Scopes (im/mpim/groups/channels history+read, search:read)." },
  { key: "slack.clientSecret", label: "OAuth Client Secret", secret: true, optional: true },
];
const GOOGLE_FIELDS: ProviderField[] = [
  { key: "google.oauth.clientId", label: "OAuth Client ID", placeholder: "…apps.googleusercontent.com", hint: "Enables Google sign-in to this console and lets people connect Gmail + Calendar. Redirect URIs: <your-url>/api/auth/callback/google and <your-url>/api/oauth/google/callback.", optional: true },
  { key: "google.oauth.clientSecret", label: "OAuth Client Secret", secret: true, optional: true },
];

export function Setup({ onComplete }: { onComplete: () => void }): JSX.Element {
  const toast = useToast();
  const save = useSaveState();
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<string>("azure");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const val = (key: string): string => values[key] ?? "";
  const setVal = (key: string, v: string): void => setValues((prev) => ({ ...prev, [key]: v }));

  useEffect(() => {
    void (async () => {
      try {
        const entries = await getConfig();
        const parsed: Record<string, string> = {};
        for (const e of entries) {
          try {
            parsed[e.key] = String(JSON.parse(e.value));
          } catch {
            parsed[e.key] = e.value;
          }
        }
        setValues(parsed);
        if (parsed["model.provider"] && PROVIDERS[parsed["model.provider"]]) setProvider(parsed["model.provider"]);
      } catch {
        /* first boot — empty form */
      }
      setLoaded(true);
    })();
  }, []);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!val("slack.botToken").trim()) e["slack.botToken"] = "Bot token is required.";
    else if (!val("slack.botToken").trim().startsWith("xoxb-")) e["slack.botToken"] = "Must start with xoxb-";
    if (!val("slack.appToken").trim()) e["slack.appToken"] = "App token is required.";
    else if (!val("slack.appToken").trim().startsWith("xapp-")) e["slack.appToken"] = "Must start with xapp-";
    for (const f of PROVIDERS[provider].fields) {
      if (!f.optional && !val(f.key).trim()) e[f.key] = `${f.label} is required.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSave = async (): Promise<void> => {
    if (!validate()) return;

    const ok = await save.run(async () => {
      // ALL slack fields — incl. the optional OAuth client id/secret (the old
      // explicit two-key save silently dropped them).
      for (const f of SLACK_FIELDS) {
        if (val(f.key).trim()) await putConfig(f.key, val(f.key).trim());
      }
      await putConfig(MENTIONS_KEY, val(MENTIONS_KEY) === "asker" ? "asker" : "workspace");
      await putConfig("model.provider", provider);
      for (const f of PROVIDERS[provider].fields) {
        if (val(f.key).trim()) await putConfig(f.key, val(f.key).trim());
      }
      for (const f of GOOGLE_FIELDS) {
        if (val(f.key).trim()) await putConfig(f.key, val(f.key).trim());
      }
    });

    if (!ok) {
      toast.show("Could not save settings", "err");
      return;
    }
    const reload = await reloadSlack();
    if (!reload.ok) toast.show(`Saved, but Slack connect failed: ${reload.error ?? "unknown"}`, "err");
    if (GOOGLE_FIELDS.some((f) => val(f.key).trim())) {
      const auth = await reloadAuth();
      if (!auth.ok) toast.show(`Saved, but Google sign-in reload failed: ${auth.error ?? "unknown"}`, "err");
    }
    setTimeout(() => onComplete(), 600);
  };

  const renderField = (f: ProviderField): JSX.Element => (
    <div className="field-group" key={f.key}>
      <label className="field-label" htmlFor={f.key}>
        {f.label}
        {f.optional ? <span className="field-label-mono"> optional</span> : null}
      </label>
      {f.secret ? (
        <RevealInput id={f.key} value={val(f.key)} onChange={(v) => setVal(f.key, v)} placeholder={f.placeholder} ariaLabel={f.label} invalid={!!errors[f.key]} />
      ) : (
        <input
          id={f.key}
          className="field-input"
          type="text"
          value={val(f.key)}
          onChange={(e) => setVal(f.key, e.target.value)}
          placeholder={f.placeholder}
          autoComplete="off"
          aria-invalid={errors[f.key] ? "true" : undefined}
        />
      )}
      {f.hint ? <div className="field-hint">{f.hint}</div> : null}
      <div className={`field-error${errors[f.key] ? " visible" : ""}`} role="alert" aria-live="polite">
        {errors[f.key] ?? ""}
      </div>
    </div>
  );

  if (!loaded) {
    return (
      <div className="page">
        <div className="logo-block">
          <img src="/assets/tino-logo.png" alt="tino" className="logo-img" />
          <span className="logo-wordmark">tino</span>
        </div>
        <p className="empty">loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" className="logo-img" />
        <span className="logo-wordmark">tino</span>
      </div>

      <div className="setup-screen">
        <h1 className="setup-heading">set up tino.</h1>
        <p className="setup-lead">connect Slack, pick a model provider, and (optionally) Google.</p>

        <h2 className="setup-section">Slack</h2>
        {SLACK_FIELDS.map(renderField)}

        <div className="field-group">
          <label className="field-label" htmlFor="channel-mentions">
            When @mentioned in a channel, tino may use
          </label>
          <select
            id="channel-mentions"
            className="field-input"
            value={val(MENTIONS_KEY) === "asker" ? "asker" : "workspace"}
            onChange={(e) => setVal(MENTIONS_KEY, e.target.value)}
          >
            <option value="workspace">only what the channel can see (recommended)</option>
            <option value="asker">the asker's private context too</option>
          </select>
          <div className="field-hint">
            {val(MENTIONS_KEY) === "asker"
              ? "Channel replies can draw on the asker's email, calendar, DMs, private knowledge, personal MCP servers, and private conversations. Only an instruction to the model keeps private details out of a reply the whole channel reads — and anyone in the channel can post text that tries to override it."
              : "Channel replies use only what everyone in the channel may see: public channels, the channel itself, the workspace knowledge base, and workspace MCP servers marked as shareable. In channels with people from outside the company, only the channel itself. For anything private, tino answers in the asker's DM."}
          </div>
        </div>

        <h2 className="setup-section">Model</h2>
        <div className="field-group">
          <label className="field-label" htmlFor="model-provider">
            Provider
          </label>
          <select
            id="model-provider"
            className="field-input"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setErrors({});
            }}
          >
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].label}
              </option>
            ))}
          </select>
          {PROVIDERS[provider].note ? <div className="field-hint">{PROVIDERS[provider].note}</div> : null}
        </div>
        {PROVIDERS[provider].fields.map(renderField)}

        <h2 className="setup-section">Google sign-in + Gmail (optional)</h2>
        {GOOGLE_FIELDS.map(renderField)}

        <div className="btn-row">
          <SaveButton
            state={save.state}
            idleLabel="save & connect"
            savingLabel="saving…"
            savedLabel="saved"
            errorLabel="failed — retry"
            size="large"
            onClick={onSave}
          />
        </div>
      </div>
    </div>
  );
}
