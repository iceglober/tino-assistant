import { type JSX, useEffect, useState } from "react";
import { CapabilityCard, type CapabilityShape } from "../components/CapabilityCard.js";
import { ComplianceSection } from "../components/ComplianceSection.js";
import { ConfigTable } from "../components/ConfigTable.js";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { RevealInput } from "../components/RevealInput.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import { getCapabilities, getConfig, putConfig, reloadSlack } from "../lib/api.js";
import { isCapabilityConnected } from "../lib/capabilityTools.js";

/**
 * Main console — shown once Slack + basics are configured.
 *
 * Mirror: `html.ts:1206-1430` (markup) + the `initConsole`, `loadCapabilities`,
 * `saveSlackEdit`, `saveAgentEdit` handlers at `html.ts:1866-2033, 2069-2073`.
 *
 * Sections:
 *   1. Header (logo, status dot, signed-in user, sign out)
 *   2. Capabilities grid (one CapabilityCard per `capability.<id>` config entry)
 *   3. Core config (Slack tokens edit, Agent config edit) — two static cards
 *   4. Raw config table (collapsible)
 *   5. Compliance status (collapsible)
 *   6. Health footer
 */
export function Console({
  initialSlackBot = "",
  initialSlackApp = "",
  initialModelId = "",
  initialAdminId = "",
}: {
  initialSlackBot?: string;
  initialSlackApp?: string;
  initialModelId?: string;
  initialAdminId?: string;
}): JSX.Element {
  const { session, signOut } = useAuth();
  const { health } = useHealth();
  const toast = useToast();

  const status: "ok" | "degraded" | "unreachable" | "checking" = !health ? "checking" : health.ok ? "ok" : "degraded";

  // ── Capabilities ────────────────────────────────────────────────────
  const [caps, setCaps] = useState<CapabilityShape[]>([]);
  const [capsError, setCapsError] = useState<string | null>(null);

  const loadCaps = async (): Promise<void> => {
    try {
      const data = await getCapabilities();
      // Server returns the full console-facing view per capability:
      //   { id, displayName, enabled, fields: [...], findWork?, updatedAt? }
      // Pass through unchanged — CapabilityCard reads `fields` directly.
      setCaps(data as unknown as CapabilityShape[]);
      setCapsError(null);
    } catch (err) {
      setCapsError((err as Error).message);
    }
  };

  useEffect(() => {
    void loadCaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);

  // ── Slack edit ──────────────────────────────────────────────────────
  const [slackBot, setSlackBot] = useState(initialSlackBot);
  const [slackApp, setSlackApp] = useState(initialSlackApp);
  const [slackBotErr, setSlackBotErr] = useState("");
  const [slackAppErr, setSlackAppErr] = useState("");
  const [slackOpen, setSlackOpen] = useState(false);
  const slackSave = useSaveState();

  const validateSlackToken = (val: string, prefix: string): string => {
    if (!val.trim()) return "Token is required.";
    if (!val.trim().startsWith(prefix)) return `Token must start with ${prefix}`;
    return "";
  };

  const onSaveSlack = async (): Promise<void> => {
    const be = validateSlackToken(slackBot, "xoxb-");
    const ae = validateSlackToken(slackApp, "xapp-");
    setSlackBotErr(be);
    setSlackAppErr(ae);
    if (be || ae) return;

    const ok = await slackSave.run(async () => {
      await putConfig("slack.botToken", slackBot.trim());
      await putConfig("slack.appToken", slackApp.trim());
    });
    if (!ok) {
      toast.show("Could not save tokens", "err");
      return;
    }
    // Wave 3.1 — apply the new tokens without a process restart.
    const reload = await reloadSlack();
    if (reload.ok) toast.show("Slack tokens updated — reconnected", "ok");
    else toast.show(`Saved, but reconnect failed: ${reload.error ?? "unknown"}`, "err");
  };

  // ── Agent edit ──────────────────────────────────────────────────────
  const [modelId, setModelId] = useState(initialModelId);
  const [adminId, setAdminId] = useState(initialAdminId);
  const [modelErr, setModelErr] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const agentSave = useSaveState();

  const onSaveAgent = async (): Promise<void> => {
    const me = !modelId.trim() ? "Model ID is required" : "";
    const ae = !adminId.trim() ? "User ID is required" : "";
    setModelErr(me);
    setAdminErr(ae);
    if (me || ae) return;

    const ok = await agentSave.run(async () => {
      await putConfig("bedrock.modelId", modelId.trim());
      await putConfig("slack.adminUserId", adminId.trim());
    });
    if (ok) toast.show("Agent config updated", "ok");
    else toast.show("Could not save", "err");
  };

  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={() => void signOut()} />

      <div className="section-label">capabilities</div>
      <div className="cap-grid">
        {capsError ? (
          <p className="empty">error loading capabilities: {capsError}</p>
        ) : caps.length === 0 ? (
          <p className="empty">no capabilities configured</p>
        ) : (
          caps.map((cap) => (
            <CapabilityCard
              key={cap.id}
              cap={{
                ...cap,
                connected: health ? isCapabilityConnected(cap.id, health.tools) : undefined,
              }}
              onChanged={loadCaps}
            />
          ))
        )}
      </div>

      <div className="section-label">core config</div>
      <div className="cap-grid" style={{ marginBottom: 28 }}>
        {/* Slack card */}
        <div className={`cap-card${slackOpen ? " open" : ""}`}>
          {/* biome-ignore lint/a11y/useSemanticElements: card-header is a click target with nested layout; replacing with <button> would alter styling/structure */}
          <div
            className="cap-card-header"
            role="button"
            tabIndex={0}
            aria-expanded={slackOpen}
            onClick={() => setSlackOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSlackOpen((v) => !v);
              }
            }}
          >
            <span className="cap-card-icon">💬</span>
            <div className="cap-card-meta">
              <div className="cap-card-name">Slack</div>
              <div className="cap-card-desc">bot + app tokens</div>
            </div>
            <div className="cap-card-status">
              <span className="status-connected">● connected</span>
            </div>
            <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M5 3l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="cap-detail-wrap">
            <div className="cap-detail-inner">
              <div className="cap-detail">
                <div className="detail-section">
                  <div className="detail-label">Bot Token</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <RevealInput
                      value={slackBot}
                      onChange={setSlackBot}
                      ariaLabel="Slack Bot Token"
                      invalid={!!slackBotErr}
                      onBlur={() => setSlackBotErr(validateSlackToken(slackBot, "xoxb-"))}
                    />
                    <div className={`field-error${slackBotErr ? " visible" : ""}`} role="alert" aria-live="polite">
                      {slackBotErr}
                    </div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">App Token</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <RevealInput
                      value={slackApp}
                      onChange={setSlackApp}
                      ariaLabel="Slack App Token"
                      invalid={!!slackAppErr}
                      onBlur={() => setSlackAppErr(validateSlackToken(slackApp, "xapp-"))}
                    />
                    <div className={`field-error${slackAppErr ? " visible" : ""}`} role="alert" aria-live="polite">
                      {slackAppErr}
                    </div>
                  </div>
                </div>
                <div className="btn-row">
                  <SaveButton state={slackSave.state} idleLabel="save tokens" size="setup" onClick={onSaveSlack} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Agent card */}
        <div className={`cap-card${agentOpen ? " open" : ""}`}>
          {/* biome-ignore lint/a11y/useSemanticElements: card-header is a click target with nested layout; replacing with <button> would alter styling/structure */}
          <div
            className="cap-card-header"
            role="button"
            tabIndex={0}
            aria-expanded={agentOpen}
            onClick={() => setAgentOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAgentOpen((v) => !v);
              }
            }}
          >
            <span className="cap-card-icon">🤖</span>
            <div className="cap-card-meta">
              <div className="cap-card-name">Agent</div>
              <div className="cap-card-desc">model + admin user</div>
            </div>
            <div className="cap-card-status">
              <span className="status-connected">● configured</span>
            </div>
            <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M5 3l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="cap-detail-wrap">
            <div className="cap-detail-inner">
              <div className="cap-detail">
                <div className="detail-section">
                  <div className="detail-label">Bedrock Model ID</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <input
                      className="field-input"
                      type="text"
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      autoComplete="off"
                      aria-label="Bedrock Model ID"
                      aria-invalid={modelErr ? "true" : undefined}
                      onBlur={() => setModelErr(!modelId.trim() ? "Model ID is required" : "")}
                    />
                    <div className={`field-error${modelErr ? " visible" : ""}`} role="alert" aria-live="polite">
                      {modelErr}
                    </div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">Admin User ID</div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <input
                      className="field-input"
                      type="text"
                      value={adminId}
                      onChange={(e) => setAdminId(e.target.value)}
                      autoComplete="off"
                      aria-label="Admin Slack User ID"
                      aria-invalid={adminErr ? "true" : undefined}
                      onBlur={() => setAdminErr(!adminId.trim() ? "User ID is required" : "")}
                    />
                    <div className={`field-error${adminErr ? " visible" : ""}`} role="alert" aria-live="polite">
                      {adminErr}
                    </div>
                  </div>
                </div>
                <div className="btn-row">
                  <SaveButton state={agentSave.state} idleLabel="save" size="setup" onClick={onSaveAgent} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfigTable />
      <ComplianceSection />
      <HealthFooter health={health} />
    </div>
  );
}

/**
 * Convenience: read the config store and pull out the four core values used
 * by the Console pre-fill. Centralizes the JSON-unwrap that the legacy code
 * did inline.
 */
export async function fetchInitialConsoleValues(): Promise<{
  slackBot: string;
  slackApp: string;
  modelId: string;
  adminId: string;
}> {
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
  return {
    slackBot: get("slack.botToken"),
    slackApp: get("slack.appToken"),
    modelId: get("bedrock.modelId"),
    adminId: get("slack.adminUserId"),
  };
}
