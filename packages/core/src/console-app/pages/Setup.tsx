import { type JSX, useEffect, useState } from "react";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useToast } from "../hooks/useToast.js";
import { getConfig, putConfig, reloadSlack } from "../lib/api.js";

/**
 * One-screen setup: the three things Tino needs to run.
 *   - Slack: bot + app tokens (so it can receive DMs / @mentions).
 *   - Azure OpenAI: the model that powers replies.
 *   - Google (optional): OAuth client so users can connect Gmail + Calendar.
 *
 * Writes the exact config keys the backend reads, then hot-reloads Slack (which
 * also rebuilds the Azure model) so edits take effect without a restart.
 */
export function Setup({ onComplete }: { onComplete: () => void }): JSX.Element {
  const toast = useToast();
  const save = useSaveState();
  const [loaded, setLoaded] = useState(false);

  // Slack
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  // Azure OpenAI
  const [azureApiKey, setAzureApiKey] = useState("");
  const [azureResource, setAzureResource] = useState("");
  const [azureDeployment, setAzureDeployment] = useState("");
  const [azureApiVersion, setAzureApiVersion] = useState("");
  // Google OAuth (optional)
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      try {
        const entries = await getConfig();
        const get = (k: string): string => {
          const e = entries.find((x) => x.key === k);
          if (!e) return "";
          try {
            return String(JSON.parse(e.value));
          } catch {
            return e.value;
          }
        };
        setBotToken(get("slack.botToken"));
        setAppToken(get("slack.appToken"));
        setAzureApiKey(get("azure.apiKey"));
        setAzureResource(get("azure.resourceName"));
        setAzureDeployment(get("azure.deployment"));
        setAzureApiVersion(get("azure.apiVersion"));
        setGoogleClientId(get("google.oauth.clientId"));
        setGoogleClientSecret(get("google.oauth.clientSecret"));
      } catch {
        /* first boot — empty form */
      }
      setLoaded(true);
    })();
  }, []);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!botToken.trim()) e.botToken = "Bot token is required.";
    else if (!botToken.trim().startsWith("xoxb-")) e.botToken = "Must start with xoxb-";
    if (!appToken.trim()) e.appToken = "App token is required.";
    else if (!appToken.trim().startsWith("xapp-")) e.appToken = "Must start with xapp-";
    if (!azureApiKey.trim()) e.azureApiKey = "API key is required.";
    if (!azureResource.trim()) e.azureResource = "Resource name is required.";
    if (!azureDeployment.trim()) e.azureDeployment = "Deployment name is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSave = async (): Promise<void> => {
    if (!validate()) return;

    const ok = await save.run(async () => {
      await putConfig("slack.botToken", botToken.trim());
      await putConfig("slack.appToken", appToken.trim());
      await putConfig("azure.apiKey", azureApiKey.trim());
      await putConfig("azure.resourceName", azureResource.trim());
      await putConfig("azure.deployment", azureDeployment.trim());
      if (azureApiVersion.trim()) await putConfig("azure.apiVersion", azureApiVersion.trim());
      if (googleClientId.trim()) await putConfig("google.oauth.clientId", googleClientId.trim());
      if (googleClientSecret.trim()) await putConfig("google.oauth.clientSecret", googleClientSecret.trim());
    });

    if (!ok) {
      toast.show("Could not save settings", "err");
      return;
    }
    const reload = await reloadSlack();
    if (!reload.ok) {
      toast.show(`Saved, but Slack connect failed: ${reload.error ?? "unknown"}`, "err");
    }
    setTimeout(() => onComplete(), 600);
  };

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

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { placeholder?: string; hint?: string; secret?: boolean } = {},
  ): JSX.Element => (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {opts.secret ? (
        <RevealInput id={id} value={value} onChange={onChange} placeholder={opts.placeholder} ariaLabel={label} invalid={!!errors[id]} />
      ) : (
        <input
          id={id}
          className="field-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={opts.placeholder}
          autoComplete="off"
          aria-invalid={errors[id] ? "true" : undefined}
        />
      )}
      {opts.hint ? <div className="field-hint">{opts.hint}</div> : null}
      <div className={`field-error${errors[id] ? " visible" : ""}`} role="alert" aria-live="polite">
        {errors[id] ?? ""}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" className="logo-img" />
        <span className="logo-wordmark">tino</span>
      </div>

      <div className="setup-screen">
        <h1 className="setup-heading">set up tino.</h1>
        <p className="setup-lead">three things to get running: a Slack app, an Azure OpenAI model, and (optionally) Google.</p>

        <h2 className="setup-section">Slack</h2>
        {field("botToken", "Bot Token", botToken, setBotToken, {
          placeholder: "xoxb-…",
          hint: "Slack → your app → OAuth & Permissions → Bot User OAuth Token",
          secret: true,
        })}
        {field("appToken", "App Token", appToken, setAppToken, {
          placeholder: "xapp-…",
          hint: "Slack → your app → Basic Information → App-Level Tokens (connections:write)",
          secret: true,
        })}

        <h2 className="setup-section">Azure OpenAI</h2>
        {field("azureApiKey", "API Key", azureApiKey, setAzureApiKey, {
          placeholder: "your Azure OpenAI key",
          hint: "Azure portal → your OpenAI resource → Keys and Endpoint",
          secret: true,
        })}
        {field("azureResource", "Resource Name", azureResource, setAzureResource, {
          placeholder: "my-openai-resource",
          hint: "The resource name in your endpoint: https://<name>.openai.azure.com",
        })}
        {field("azureDeployment", "Deployment Name", azureDeployment, setAzureDeployment, {
          placeholder: "gpt-4o",
          hint: "The deployment you created for the model, not the model id.",
        })}
        {field("azureApiVersion", "API Version (optional)", azureApiVersion, setAzureApiVersion, {
          placeholder: "leave blank for the default",
        })}

        <h2 className="setup-section">Google (optional)</h2>
        {field("googleClientId", "OAuth Client ID", googleClientId, setGoogleClientId, {
          placeholder: "…apps.googleusercontent.com",
          hint: "Needed so you can connect Gmail + Calendar from the chat.",
        })}
        {field("googleClientSecret", "OAuth Client Secret", googleClientSecret, setGoogleClientSecret, {
          secret: true,
        })}

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
