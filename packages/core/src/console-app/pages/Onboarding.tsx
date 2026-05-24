import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { DiscoveryProgress, DiscoveryResult, Session } from "../lib/api.js";
import { getDiscoveryResult, getPrivacyStatus, startDiscovery } from "../lib/api.js";

type Phase = "checking" | "connect" | "running" | "done";

export function Onboarding({
  onComplete,
}: {
  session: Session;
  onComplete: () => void;
}): JSX.Element {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    // Check for OAuth callback first
    const params = new URLSearchParams(window.location.search);
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
      try {
        const existing = await getDiscoveryResult();
        if (existing) {
          setResult(existing);
          setPhase("done");
          return;
        }

        const status = await getPrivacyStatus();
        const hasGoogle = status.connectedCapabilities.some(
          (c) => c === "gmail" || c === "calendar",
        );
        if (hasGoogle) {
          runDiscoveryFlow();
        } else {
          setPhase("connect");
        }
      } catch {
        setPhase("connect");
      }
    })();

    return () => {
      abortRef.current?.abort();
    };
  }, [runDiscoveryFlow, toast]);

  return (
    <div className="onboarding-page">
      <div className="onboarding-container">
        <img src="/assets/tino-logo.png" alt="tino" className="onboarding-logo" />

        {phase === "checking" && <p className="empty">loading…</p>}

        {phase === "connect" && (
          <>
            <h1 className="setup-heading">connect your Google account</h1>
            <p className="setup-lead">
              tino needs read-only access to your email and calendar to understand your role
              and communication patterns.
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
            <p className="setup-lead">
              tino is analyzing your recent emails and calendar to understand how you work.
            </p>
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
                <p>{result.roleSummary}</p>
              </div>

              {result.duties.length > 0 && (
                <div className="discovery-section">
                  <h3>key responsibilities</h3>
                  <ul className="discovery-list">
                    {result.duties.map((d, i) => (
                      <li key={i}>
                        <strong>{d.title}</strong>
                        {d.frequency && (
                          <span className="discovery-freq">{d.frequency}</span>
                        )}
                        <p>{d.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.suggestions.length > 0 && (
                <div className="discovery-section">
                  <h3>suggestions</h3>
                  <ul className="discovery-list">
                    {result.suggestions.map((s, i) => (
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
              <button
                className="btn btn-primary btn-large"
                type="button"
                onClick={onComplete}
              >
                continue to dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
