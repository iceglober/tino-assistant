import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { DiscoveryProgress, DiscoveryResult, Session } from "../lib/api.js";
import { getDiscoveryResult, getMe, getPrivacyStatus, getSlackOAuthStatus, startDiscovery } from "../lib/api.js";

type Phase = "checking" | "verify-slack" | "slack-connect" | "connect" | "running" | "done";

export function Onboarding({ session, onComplete }: { session: Session; onComplete: () => void }): JSX.Element {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const advanceToDiscovery = useCallback(async () => {
    try {
      const existing = await getDiscoveryResult();
      if (existing) {
        setResult(existing);
        setPhase("done");
        return;
      }
    } catch {
      /* no cached discovery */
    }
    try {
      const status = await getPrivacyStatus();
      const hasGoogle = status.connectedCapabilities.some((c) => c === "gmail" || c === "calendar");
      if (hasGoogle) {
        setPhase("running");
        setProgress(null);
        abortRef.current = startDiscovery(
          (p) => setProgress(p),
          (r) => {
            setResult(r);
            setPhase("done");
          },
          (err) => {
            toast.show(`Discovery failed: ${err.message}`, "err");
            setPhase("connect");
          },
        );
        return;
      }
    } catch {
      /* no Google creds — show connect */
    }
    setPhase("connect");
  }, [toast]);

  const advanceToSlackConnect = useCallback(async () => {
    try {
      const status = await getSlackOAuthStatus();
      if (status.configured && !status.connected) {
        setPhase("slack-connect");
        return;
      }
    } catch {
      /* Slack OAuth not available — skip */
    }
    await advanceToDiscovery();
  }, [advanceToDiscovery]);

  const runDiscoveryFlow = useCallback(() => {
    setPhase("running");
    setProgress(null);
    abortRef.current = startDiscovery(
      (p) => setProgress(p),
      (r) => {
        setResult(r);
        setPhase("done");
      },
      (err) => {
        toast.show(`Discovery failed: ${err.message}`, "err");
        setPhase("connect");
      },
    );
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const slackOauth = params.get("slack_oauth");
    if (slackOauth === "success") {
      window.history.replaceState({}, "", "/");
      void advanceToDiscovery();
      return;
    }
    if (slackOauth && slackOauth !== "success") {
      window.history.replaceState({}, "", "/");
      toast.show(`Slack connection failed: ${slackOauth}`, "err");
    }

    const oauth = params.get("oauth");
    if (oauth === "success") {
      window.history.replaceState({}, "", "/");
      runDiscoveryFlow();
      return;
    }
    if (oauth && oauth !== "success") {
      window.history.replaceState({}, "", "/");
      toast.show(`Google connection failed: ${oauth}`, "err");
    }

    void (async () => {
      if (!session.user.slackUserId) {
        setPhase("verify-slack");
        return;
      }

      await advanceToSlackConnect();
    })();

    return () => {
      abortRef.current?.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session, advanceToSlackConnect, advanceToDiscovery, runDiscoveryFlow, toast]);

  useEffect(() => {
    if (phase !== "verify-slack") return;

    pollRef.current = setInterval(async () => {
      try {
        const me = await getMe();
        if (me.slackUserId) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          void advanceToSlackConnect();
        }
      } catch {
        /* retry on next tick */
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [phase, advanceToSlackConnect]);

  return (
    <div className="onboarding-page">
      <div className="onboarding-container">
        <img src="/assets/tino-logo.png" alt="tino" className="onboarding-logo" />

        {phase === "checking" && <p className="empty">loading…</p>}

        {phase === "verify-slack" && (
          <>
            <h1 className="setup-heading">say hi to tino in Slack</h1>
            <p className="setup-lead">open Slack and send tino a direct message to verify the connection.</p>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
              <div className="pulse-dot" />
            </div>
            <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginTop: 16, textAlign: "center" }}>
              waiting for your first message…
            </p>
          </>
        )}

        {phase === "slack-connect" && (
          <>
            <h1 className="setup-heading">connect your Slack account</h1>
            <p className="setup-lead">let tino search your Slack messages and read your DMs for better context.</p>
            <div className="btn-row" style={{ justifyContent: "center" }}>
              <button
                className="btn btn-primary btn-large"
                type="button"
                onClick={() => {
                  window.location.href = "/api/oauth/slack/authorize";
                }}
              >
                connect Slack
              </button>
            </div>
            <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginTop: 12, textAlign: "center" }}>
              grants read-only search and DM access. you can disconnect any time.
            </p>
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button className="btn-ghost" type="button" onClick={() => void advanceToDiscovery()}>
                skip for now
              </button>
            </div>
          </>
        )}

        {phase === "connect" && (
          <>
            <h1 className="setup-heading">connect your Google account</h1>
            <p className="setup-lead">
              tino needs read-only access to your email and calendar to understand your role and communication patterns.
            </p>
            <div className="btn-row" style={{ justifyContent: "center" }}>
              <button
                className="btn btn-primary btn-large"
                type="button"
                onClick={() => {
                  window.location.href = "/api/oauth/google/authorize";
                }}
              >
                connect Google
              </button>
            </div>
            <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginTop: 12, textAlign: "center" }}>
              read-only access only. you can disconnect any time from capabilities.
            </p>
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button className="btn-ghost" type="button" onClick={onComplete}>
                skip for now
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <div className="onboarding-scan">
            <h1 className="setup-heading">learning about your role…</h1>
            <p className="setup-lead">tino is analyzing your recent emails and calendar to understand how you work.</p>
            {progress && (
              <div className="scan-progress" style={{ justifyContent: "center" }}>
                <div className="scan-progress-bar" style={{ maxWidth: 400 }}>
                  <div className="scan-progress-fill" style={{ width: `${progress.pct}%` }} />
                </div>
                <span className="scan-progress-label">{progress.message}</span>
              </div>
            )}
          </div>
        )}

        {phase === "done" && result && (
          <>
            <h1 className="setup-heading">here's what tino learned</h1>

            <div className="discovery-result">
              <div className="discovery-section">
                <h3>your role</h3>
                {(result.inferredTitle || result.inferredDepartment) && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    {result.inferredTitle && (
                      <span
                        style={{
                          fontSize: "0.786rem",
                          fontWeight: 600,
                          color: "var(--accent)",
                          background: "var(--accent-dim, rgba(99,102,241,0.1))",
                          borderRadius: 4,
                          padding: "2px 6px",
                        }}
                      >
                        {result.inferredTitle}
                      </span>
                    )}
                    {result.inferredDepartment && (
                      <span
                        style={{
                          fontSize: "0.786rem",
                          color: "var(--text-dim)",
                          background: "var(--surface-2, rgba(0,0,0,0.05))",
                          borderRadius: 4,
                          padding: "2px 6px",
                        }}
                      >
                        {result.inferredDepartment}
                      </span>
                    )}
                  </div>
                )}
                <p>{result.roleSummary}</p>
              </div>

              {(result.responsibilities?.length ?? 0) > 0 && (
                <div className="discovery-section">
                  <h3>key responsibilities</h3>
                  <ul className="discovery-list">
                    {(result.responsibilities ?? []).slice(0, 5).map((r, i) => (
                      <li key={i}>
                        <strong>{r.title}</strong>
                        {r.timeHorizon && <span className="discovery-freq">{r.timeHorizon}</span>}
                        <p>{r.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(result.suggestions?.length ?? 0) > 0 && (
                <div className="discovery-section">
                  <h3>suggestions</h3>
                  <ul className="discovery-list">
                    {(result.suggestions ?? []).map((s, i) => (
                      <li key={i}>
                        <strong>{s.title}</strong>
                        <p>{s.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="btn-row" style={{ justifyContent: "center", marginTop: 24 }}>
              <button className="btn btn-primary btn-large" type="button" onClick={onComplete}>
                continue to dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
