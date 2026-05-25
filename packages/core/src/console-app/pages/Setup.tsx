import { type JSX, useEffect, useState } from "react";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useToast } from "../hooks/useToast.js";
import type { Session } from "../lib/api.js";
import { getConfig, putConfig, reloadSlack } from "../lib/api.js";

export function Setup({
  session,
  onComplete,
}: {
  session?: Session | null;
  onComplete: () => void;
}): JSX.Element {
  const toast = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loaded, setLoaded] = useState(false);
  const [slackBanner, setSlackBanner] = useState(false);
  const [oauthBanner, setOauthBanner] = useState(false);

  // Step 1: Slack bot + app tokens
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [botErr, setBotErr] = useState("");
  const [appErr, setAppErr] = useState("");
  const slackSave = useSaveState();

  // Step 2: Slack OAuth credentials
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [clientIdErr, setClientIdErr] = useState("");
  const [clientSecretErr, setClientSecretErr] = useState("");
  const oauthSave = useSaveState();

  // Step 3: Agent
  const [modelId, setModelId] = useState("");
  const [modelErr, setModelErr] = useState("");
  const basicsSave = useSaveState();

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
        const hasSlack = !!(get("slack.botToken") && get("slack.appToken"));
        const hasOAuth = !!(get("slack.clientId") && get("slack.clientSecret"));
        if (hasSlack && hasOAuth) setStep(3);
        else if (hasSlack) setStep(2);
      } catch {
        /* first boot — start at step 1 */
      }
      setLoaded(true);
    })();
  }, []);

  const validateSlackToken = (val: string, prefix: string): string => {
    if (!val.trim()) return "Token is required.";
    if (!val.trim().startsWith(prefix)) return `Token must start with ${prefix}`;
    return "";
  };

  const onConnectSlack = async (): Promise<void> => {
    const be = validateSlackToken(botToken, "xoxb-");
    const ae = validateSlackToken(appToken, "xapp-");
    setBotErr(be);
    setAppErr(ae);
    if (be || ae) return;

    const ok = await slackSave.run(async () => {
      await putConfig("slack.botToken", botToken.trim());
      await putConfig("slack.appToken", appToken.trim());
      await putConfig("capability.slack", JSON.stringify({ enabled: true, credentials: {}, settings: {} }));
    });
    if (ok) {
      setTimeout(() => {
        setSlackBanner(true);
        setStep(2);
      }, 600);
    } else {
      toast.show("Could not save tokens", "err");
    }
  };

  const onSaveOAuth = async (): Promise<void> => {
    const idErr = !clientId.trim() ? "Client ID is required." : "";
    const secErr = !clientSecret.trim() ? "Client Secret is required." : "";
    setClientIdErr(idErr);
    setClientSecretErr(secErr);
    if (idErr || secErr) return;

    const ok = await oauthSave.run(async () => {
      await putConfig("slack.clientId", clientId.trim());
      await putConfig("slack.clientSecret", clientSecret.trim());
    });
    if (ok) {
      setTimeout(() => {
        setOauthBanner(true);
        setStep(3);
      }, 600);
    } else {
      toast.show("Could not save credentials", "err");
    }
  };

  const onSaveBasics = async (): Promise<void> => {
    const me = !modelId.trim() ? "Model ID is required" : "";
    setModelErr(me);
    if (me) return;

    const ok = await basicsSave.run(async () => {
      await putConfig("bedrock.modelId", modelId.trim());
    });
    if (ok) {
      const reload = await reloadSlack();
      if (!reload.ok) {
        toast.show(`Config saved, but Slack connect failed: ${reload.error ?? "unknown"}`, "err");
      }
      setTimeout(() => onComplete(), 700);
    } else {
      toast.show("Could not save config", "err");
    }
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

  return (
    <div className="page">
      <div className="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" className="logo-img" />
        <span className="logo-wordmark">tino</span>
      </div>

      {step === 1 && (
        <div className="setup-screen">
          <h1 className="setup-heading">connect Slack.</h1>
          <p className="setup-lead">
            tino lives in Slack. give it your bot and app tokens and it'll be ready to take requests in under a minute.
          </p>

          <div className="field-group">
            <label className="field-label" htmlFor="slack-bot-token">
              Bot Token <span className="field-label-mono">xoxb-…</span>
            </label>
            <RevealInput
              id="slack-bot-token"
              value={botToken}
              onChange={setBotToken}
              placeholder="xoxb-…"
              ariaLabel="Slack Bot Token"
              ariaDescribedBy="slack-bot-token-hint slack-bot-token-error"
              invalid={!!botErr}
              onBlur={() => setBotErr(validateSlackToken(botToken, "xoxb-"))}
            />
            <div className="field-hint" id="slack-bot-token-hint">
              Slack → your app → OAuth &amp; Permissions → Bot User OAuth Token
            </div>
            <div
              className={`field-error${botErr ? " visible" : ""}`}
              id="slack-bot-token-error"
              role="alert"
              aria-live="polite"
            >
              {botErr}
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="slack-app-token">
              App Token <span className="field-label-mono">xapp-…</span>
            </label>
            <RevealInput
              id="slack-app-token"
              value={appToken}
              onChange={setAppToken}
              placeholder="xapp-…"
              ariaLabel="Slack App Token"
              ariaDescribedBy="slack-app-token-hint slack-app-token-error"
              invalid={!!appErr}
              onBlur={() => setAppErr(validateSlackToken(appToken, "xapp-"))}
            />
            <div className="field-hint" id="slack-app-token-hint">
              Slack → your app → Basic Information → App-Level Tokens (connections:write scope)
            </div>
            <div
              className={`field-error${appErr ? " visible" : ""}`}
              id="slack-app-token-error"
              role="alert"
              aria-live="polite"
            >
              {appErr}
            </div>
          </div>

          <div className="btn-row">
            <SaveButton
              state={slackSave.state}
              idleLabel="connect Slack"
              savingLabel="connecting…"
              savedLabel="connected"
              errorLabel="failed — retry"
              size="large"
              onClick={onConnectSlack}
            />
          </div>

          <hr className="divider" />
          <div className="help-block">
            <p>need help finding your tokens?</p>
            <ol className="step-list" style={{ marginTop: 8 }}>
              <li>
                <span className="step-num">1</span>
                <span>
                  Go to{" "}
                  <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
                    api.slack.com/apps
                  </a>{" "}
                  and open your app
                </span>
              </li>
              <li>
                <span className="step-num">2</span>
                <span>OAuth &amp; Permissions → Bot User OAuth Token (xoxb-)</span>
              </li>
              <li>
                <span className="step-num">3</span>
                <span>
                  Basic Information → App-Level Tokens → create one with <code>connections:write</code>
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="setup-screen">
          <div className={`success-banner${slackBanner ? " visible" : ""}`} role="status">
            <span className="success-banner-icon">&#10003;</span>
            <div className="success-banner-body">
              <div className="success-banner-title">Slack connected.</div>
              <div className="success-banner-sub">tino can now receive messages from your workspace.</div>
            </div>
          </div>

          <h1 className="setup-heading">enable Slack sign-in.</h1>
          <p className="setup-lead">
            each user will connect their Slack account via OAuth. enter your app's credentials so tino can manage that flow.
          </p>

          <div className="field-group">
            <label className="field-label" htmlFor="slack-client-id">
              Client ID
            </label>
            <input
              id="slack-client-id"
              className="field-input"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="1234567890.1234567890"
              autoComplete="off"
              aria-describedby="slack-client-id-hint slack-client-id-error"
              aria-invalid={clientIdErr ? "true" : undefined}
              onBlur={() => setClientIdErr(!clientId.trim() ? "Client ID is required." : "")}
            />
            <div className="field-hint" id="slack-client-id-hint">
              Slack → your app → Basic Information → App Credentials → Client ID
            </div>
            <div
              className={`field-error${clientIdErr ? " visible" : ""}`}
              id="slack-client-id-error"
              role="alert"
              aria-live="polite"
            >
              {clientIdErr}
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="slack-client-secret">
              Client Secret
            </label>
            <RevealInput
              id="slack-client-secret"
              value={clientSecret}
              onChange={setClientSecret}
              placeholder="abcdef1234…"
              ariaLabel="Slack Client Secret"
              ariaDescribedBy="slack-client-secret-hint slack-client-secret-error"
              invalid={!!clientSecretErr}
              onBlur={() => setClientSecretErr(!clientSecret.trim() ? "Client Secret is required." : "")}
            />
            <div className="field-hint" id="slack-client-secret-hint">
              Slack → your app → Basic Information → App Credentials → Client Secret
            </div>
            <div
              className={`field-error${clientSecretErr ? " visible" : ""}`}
              id="slack-client-secret-error"
              role="alert"
              aria-live="polite"
            >
              {clientSecretErr}
            </div>
          </div>

          <div className="btn-row">
            <SaveButton
              state={oauthSave.state}
              idleLabel="save credentials"
              savingLabel="saving…"
              savedLabel="saved"
              errorLabel="failed — retry"
              size="large"
              onClick={onSaveOAuth}
            />
            <button className="btn-ghost" type="button" onClick={() => setStep(1)}>
              ← back
            </button>
          </div>

          <hr className="divider" />
          <div className="help-block">
            <p>before continuing, make sure your Slack app has:</p>
            <ol className="step-list" style={{ marginTop: 8 }}>
              <li>
                <span className="step-num">1</span>
                <span>
                  <strong>Redirect URL</strong> added under OAuth &amp; Permissions:{" "}
                  <code>{`${window.location.origin}/api/oauth/slack/callback`}</code>
                </span>
              </li>
              <li>
                <span className="step-num">2</span>
                <span>
                  <strong>User Token Scopes</strong>: <code>search:read</code>, <code>im:read</code>,{" "}
                  <code>im:history</code>, <code>mpim:read</code>, <code>mpim:history</code>
                </span>
              </li>
              <li>
                <span className="step-num">3</span>
                <span>
                  <strong>Bot Token Scope</strong>: <code>users:read.email</code> (for identity matching)
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="setup-screen">
          <div className={`success-banner${oauthBanner ? " visible" : ""}`} role="status">
            <span className="success-banner-icon">&#10003;</span>
            <div className="success-banner-body">
              <div className="success-banner-title">Slack OAuth configured.</div>
              <div className="success-banner-sub">users can now connect their Slack accounts.</div>
            </div>
          </div>

          <h1 className="setup-heading">configure the agent.</h1>
          <p className="setup-lead">
            which Bedrock model should tino use?
          </p>

          <div className="field-group">
            <label className="field-label" htmlFor="bedrock-model-id">
              Bedrock Model ID
            </label>
            <input
              id="bedrock-model-id"
              className="field-input"
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="us.anthropic.claude-sonnet-4-5-20251101-v1:0"
              autoComplete="off"
              aria-describedby="bedrock-model-hint bedrock-model-error"
              aria-invalid={modelErr ? "true" : undefined}
              onBlur={() => setModelErr(!modelId.trim() ? "Model ID is required" : "")}
            />
            <div className="field-hint" id="bedrock-model-hint">
              The cross-region inference profile ID from your AWS Bedrock console.
            </div>
            <div
              className={`field-error${modelErr ? " visible" : ""}`}
              id="bedrock-model-error"
              role="alert"
              aria-live="polite"
            >
              {modelErr}
            </div>
          </div>

          <div className="btn-row">
            <SaveButton
              state={basicsSave.state}
              idleLabel="finish setup"
              savingLabel="saving…"
              savedLabel="done"
              errorLabel="failed — retry"
              size="large"
              onClick={onSaveBasics}
            />
            <button className="btn-ghost" type="button" onClick={() => setStep(2)}>
              ← back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
