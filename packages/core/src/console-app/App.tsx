import { type JSX, useEffect, useState } from "react";
import { InsecureBanner } from "./components/InsecureBanner.js";
import { useAuth } from "./hooks/useAuth.js";
import { ToastProvider } from "./hooks/useToast.js";
import { getStatus, type Session, type SetupStatus } from "./lib/api.js";
import { Chat } from "./pages/Chat.js";
import { Knowledge } from "./pages/Knowledge.js";
import { Login } from "./pages/Login.js";
import { Setup } from "./pages/Setup.js";
import { Tools } from "./pages/Tools.js";
import { Users } from "./pages/Users.js";

export type View = "chat" | "knowledge" | "tools" | "users" | "setup";

function Splash({ step }: { step: string }): JSX.Element {
  return (
    <div className="splash">
      <img src="/assets/tino-logo.png" alt="tino" className="splash-logo" />
      <div className="splash-wordmark">tino</div>
      <div className="splash-step">{step}</div>
    </div>
  );
}

function AppRouter(): JSX.Element {
  const { session, loading, signOut } = useAuth();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [view, setView] = useState<View>("chat");
  const [checkKey, setCheckKey] = useState(0);

  useEffect(() => {
    if (loading || !session) return;
    setStatus(null);
    void getStatus()
      .then(setStatus)
      .catch(() => setStatus({ slack: false, model: false, slackConnect: false, googleConnect: false, kb: false }));
  }, [loading, session, checkKey]);

  if (loading) return <Splash step="loading…" />;
  if (!session) return <Login />;
  if (!status) return <Splash step="loading…" />;

  const isAdmin = session.user.role === "admin";
  const configured = status.slack && status.model;

  // Setup holds every deployment secret, so only admins ever see it. A member
  // who arrives before an admin has finished gets told who to ask.
  if (isAdmin && (!configured || view === "setup")) {
    return (
      <Setup
        onComplete={() => {
          setView("chat");
          setCheckKey((k) => k + 1);
        }}
      />
    );
  }
  if (!configured) {
    return (
      <div className="page">
        <div className="setup-screen">
          <h1 className="setup-heading">tino isn't set up yet.</h1>
          <p className="setup-lead">an admin still needs to connect Slack and a model. check back once they have.</p>
          <div className="btn-row">
            <button className="btn-ghost" type="button" onClick={() => void signOut()}>
              sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const back = (): void => setView("chat");
  if (view === "knowledge") return <Knowledge onBack={back} />;
  if (view === "tools") return <Tools onBack={back} />;
  if (view === "users" && isAdmin) return <Users onBack={back} currentUserId={session.user.id} />;

  return <Chat session={session} status={status} signOut={signOut} onNavigate={setView} />;
}

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <InsecureBanner />
      <AppRouter />
    </ToastProvider>
  );
}

export type { Session };
