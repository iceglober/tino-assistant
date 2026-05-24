import { type JSX, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { InsecureBanner } from "./components/InsecureBanner.js";
import { Layout } from "./components/Layout.js";
import { ToastProvider } from "./hooks/useToast.js";
import { useAuth } from "./hooks/useAuth.js";
import type { Session } from "./lib/api.js";
import { getConfig, getDiscoveryResult, getMe } from "./lib/api.js";
import { Capabilities } from "./pages/Capabilities.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Login } from "./pages/Login.js";
import { Onboarding } from "./pages/Onboarding.js";
import { Setup } from "./pages/Setup.js";
import { Work } from "./pages/Work.js";
import { Workspace } from "./pages/Workspace.js";

type Phase = "loading" | "setup" | "onboarding" | "ready";

type LoadingStep = "auth" | "config" | "preferences";

const STEP_LABELS: Record<LoadingStep, string> = {
  auth: "Signing in…",
  config: "Checking configuration…",
  preferences: "Loading preferences…",
};

async function determinePhase(
  session: Session,
  onStep: (step: LoadingStep) => void,
): Promise<Phase> {
  if (session.user.role === "admin") {
    onStep("config");
    try {
      const entries = await getConfig();
      const get = (k: string): string => {
        const e = entries.find((x) => x.key === k);
        if (!e) return "";
        try { return String(JSON.parse(e.value)); } catch { return e.value; }
      };
      const hasSlack = !!(get("slack.botToken") && get("slack.appToken"));
      const hasOAuth = !!(get("slack.clientId") && get("slack.clientSecret"));
      const hasModel = !!get("bedrock.modelId");
      if (!hasSlack || !hasOAuth || !hasModel) return "setup";
    } catch {
      return "setup";
    }
  }

  onStep("preferences");
  const me = await getMe();
  if (me && session.user.role === "admin" && !me.slackUserId) return "onboarding";
  try {
    const result = await getDiscoveryResult();
    if (!result) return "onboarding";
  } catch { return "onboarding"; }

  return "ready";
}

function AppRouter(): JSX.Element {
  const { session, loading, signOut } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingStep, setLoadingStep] = useState<LoadingStep>("auth");
  const [checkKey, setCheckKey] = useState(0);
  useEffect(() => {
    if (loading) return;
    if (!session) return;

    setPhase("loading");
    setLoadingStep("auth");
    void determinePhase(session, setLoadingStep).then(setPhase);
  }, [loading, session, checkKey]);

  if (loading || (phase === "loading" && session)) {
    return (
      <div className="splash">
        <img src="/assets/tino-logo.png" alt="tino" className="splash-logo" />
        <div className="splash-wordmark">tino</div>
        <div className="splash-step">{STEP_LABELS[loadingStep]}</div>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  if (phase === "setup") {
    return <Setup session={session} onComplete={() => setCheckKey((k) => k + 1)} />;
  }
  if (phase === "onboarding") {
    return <Onboarding session={session} onComplete={() => setPhase("ready")} />;
  }

  return (
    <Routes>
      <Route element={<Layout session={session} signOut={signOut} />}>
        <Route path="/" element={
          <Dashboard
            session={session}
            signOut={signOut}
            onRecheck={() => setCheckKey((k) => k + 1)}
          />
        } />
        <Route path="/capabilities" element={<Capabilities />} />
        <Route path="/work" element={<Work />} />
        <Route path="/workspace" element={<Workspace />} />
      </Route>
      {/* Legacy redirects */}
      <Route path="/admin" element={<Navigate to="/workspace" replace />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/users" element={<Navigate to="/workspace" replace />} />
      <Route path="/onboarding" element={<Navigate to="/" replace />} />
      <Route path="/privacy" element={<Navigate to="/capabilities" replace />} />
      <Route path="/my-capabilities" element={<Navigate to="/capabilities" replace />} />
      <Route path="/me/activity" element={<Navigate to="/" replace />} />
      <Route path="/activity" element={<Navigate to="/" replace />} />
      <Route path="/console" element={<Navigate to="/" replace />} />
      <Route path="/audit" element={<Navigate to="/workspace" replace />} />
    </Routes>
  );
}

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <InsecureBanner />
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </ToastProvider>
  );
}

export type { Session };
