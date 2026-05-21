import { type JSX, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { InsecureBanner } from "./components/InsecureBanner.js";
import { ToastProvider } from "./hooks/useToast.js";
import { useAuth } from "./hooks/useAuth.js";
import type { Session } from "./lib/api.js";
import { getConfig, getPrivacyStatus } from "./lib/api.js";
import { Admin } from "./pages/Admin.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Login } from "./pages/Login.js";
import { Onboarding } from "./pages/Onboarding.js";
import { Setup } from "./pages/Setup.js";

type Phase = "loading" | "setup" | "onboarding" | "ready";

async function determinePhase(session: Session): Promise<Phase> {
  if (session.user.role === "admin") {
    try {
      const entries = await getConfig();
      const get = (k: string): string => {
        const e = entries.find((x) => x.key === k);
        if (!e) return "";
        try { return String(JSON.parse(e.value)); } catch { return e.value; }
      };
      const hasSlack = !!(get("slack.botToken") && get("slack.appToken"));
      const hasModel = !!get("bedrock.modelId");
      if (!hasSlack || !hasModel) return "setup";
    } catch {
      return "setup";
    }
  }

  try {
    const status = await getPrivacyStatus();
    if (!status.hasPrivacyConfig && status.connectedCapabilities.length > 0) {
      return "onboarding";
    }
  } catch { /* no privacy store — skip onboarding gate */ }

  return "ready";
}

function AppRouter(): JSX.Element {
  const { session, loading, signOut } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [checkKey, setCheckKey] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!session) { setPhase("ready"); return; }

    setPhase("loading");
    void determinePhase(session).then(setPhase);
  }, [loading, session, checkKey]);

  if (loading || phase === "loading") {
    return (
      <div className="splash">
        <img src="/assets/tino-logo.png" alt="tino" className="splash-logo" />
        <div className="splash-wordmark">tino</div>
      </div>
    );
  }

  if (!session) return <Login />;

  if (phase === "setup") {
    return <Setup session={session} onComplete={() => setCheckKey((k) => k + 1)} />;
  }
  if (phase === "onboarding") {
    return <Onboarding session={session} onComplete={() => setPhase("ready")} />;
  }

  return (
    <Routes>
      <Route path="/admin" element={<Admin />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* Legacy redirects */}
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/users" element={<Navigate to="/admin" replace />} />
      <Route path="/onboarding" element={<Navigate to="/" replace />} />
      <Route path="/privacy" element={<Navigate to="/" replace />} />
      <Route path="/my-capabilities" element={<Navigate to="/" replace />} />
      <Route path="/me/activity" element={<Navigate to="/" replace />} />
      <Route path="/audit" element={<Navigate to="/" replace />} />
      <Route path="*" element={
        <Dashboard
          session={session}
          signOut={signOut}
          onRecheck={() => setCheckKey((k) => k + 1)}
        />
      } />
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
