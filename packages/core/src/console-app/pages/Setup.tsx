import { type JSX, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useToast } from "../hooks/useToast.js";
import { putConfig, reloadSlack } from "../lib/api.js";

/**
 * Setup flow — two-step progressive setup.
 *
 * Mirror: `html.ts:1047-1202` (markup for screen-welcome and screen-basics) +
 * `saveSlack` and `saveBasics` at `html.ts:1589-1639`.
 *
 * Step 1: connect Slack (bot token + app token).
 * Step 2: configure agent (Bedrock model + admin user ID).
 *
 * `initialStep` is set by App.tsx based on whether Slack is already configured.
 */
export function Setup({ initialStep = 1 }: { initialStep?: 1 | 2 }): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<1 | 2>(initialStep);
  const [slackBanner, setSlackBanner] = useState(initialStep === 2);

  // Step 1 state
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [botErr, setBotErr] = useState("");
  const [appErr, setAppErr] = useState("");
  const slackSave = useSaveState();

  // Step 2 state
  const [modelId, setModelId] = useState("");
  const [adminId, setAdminId] = useState("");
  const [modelErr, setModelErr] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const basicsSave = useSaveState();

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
    });
    if (ok) {
      // Ch.8 first-success: show banner on step 2
      setTimeout(() => {
        setSlackBanner(true);
        setStep(2);
      }, 600);
    } else {
      toast.show("Could not save tokens", "err");
    }
  };

  const onSaveBasics = async (): Promise<void> => {
    const me = !modelId.trim() ? "Model ID is required" : "";
    const ae = !adminId.trim() ? "User ID is required" : "";
    setModelErr(me);
    setAdminErr(ae);
    if (me || ae) return;

    const ok = await basicsSave.run(async () => {
      await putConfig("bedrock.modelId", modelId.trim());
      await putConfig("slack.adminUserId", adminId.trim());
    });
    if (ok) {
      // Trigger Slack reconnect now that all three tokens are saved
      const reload = await reloadSlack();
      if (!reload.ok) {
        toast.show(`Config saved, but Slack connect failed: ${reload.error ?? "unknown"}`, "err");
      }
      setTimeout(() => navigate("/"), 700);
    } else {
      toast.show("Could not save config", "err");
    }
  };

  return (
    <div className="page">
      <div className="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" className="logo-img" />
        <span className="logo-wordmark">tino</span>
      </div>

      {step === 1 ? (
        <div className="setup-screen">
          {/* biome-ignore lint/a11y/useSemanticElements: progress indicator, not a form fieldset */}
          <div className="setup-steps" role="group" aria-label="Setup progress: step 1 of 3">
            <div className="setup-step active" aria-current="step" />
            <div className="setup-step" />
            <div className="setup-step" />
            <span className="setup-step-label">step 1 of 3</span>
          </div>

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
              savedLabel="✓ connected"
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
      ) : (
        <div className="setup-screen">
          {/* biome-ignore lint/a11y/useSemanticElements: progress indicator, not a form fieldset */}
          <div className="setup-steps" role="group" aria-label="Setup progress: step 2 of 3">
            <div className="setup-step done" />
            <div className="setup-step active" aria-current="step" />
            <div className="setup-step" />
            <span className="setup-step-label">step 2 of 3</span>
          </div>

          <div className={`success-banner${slackBanner ? " visible" : ""}`} role="status">
            <span className="success-banner-icon">✓</span>
            <div className="success-banner-body">
              <div className="success-banner-title">Slack connected.</div>
              <div className="success-banner-sub">tino can now receive messages from your workspace.</div>
            </div>
          </div>

          <h1 className="setup-heading">configure the agent.</h1>
          <p className="setup-lead">
            two more things: which Bedrock model to use, and your Slack user ID so tino knows who the admin is.
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

          <div className="field-group">
            <label className="field-label" htmlFor="admin-user-id">
              Your Slack User ID
            </label>
            <input
              id="admin-user-id"
              className="field-input"
              type="text"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              placeholder="U0123456789"
              autoComplete="off"
              aria-describedby="admin-user-hint admin-user-error"
              aria-invalid={adminErr ? "true" : undefined}
              onBlur={() => setAdminErr(!adminId.trim() ? "User ID is required" : "")}
            />
            <div className="field-hint" id="admin-user-hint">
              Slack → your profile → ⋯ → Copy member ID. Starts with U.
            </div>
            <div
              className={`field-error${adminErr ? " visible" : ""}`}
              id="admin-user-error"
              role="alert"
              aria-live="polite"
            >
              {adminErr}
            </div>
          </div>

          <div className="btn-row">
            <SaveButton
              state={basicsSave.state}
              idleLabel="finish setup"
              savingLabel="saving…"
              savedLabel="✓ done"
              errorLabel="failed — retry"
              size="large"
              onClick={onSaveBasics}
            />
            <button className="btn-ghost" type="button" onClick={() => setStep(1)}>
              ← back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
