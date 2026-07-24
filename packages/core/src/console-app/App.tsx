import { type JSX, useEffect, useState } from "react";
import { InsecureBanner } from "./components/InsecureBanner.js";
import { useAuth } from "./hooks/useAuth.js";
import { ToastProvider } from "./hooks/useToast.js";
import { getConfig, type Session } from "./lib/api.js";
import { Chat } from "./pages/Chat.js";
import { Login } from "./pages/Login.js";
import { Setup } from "./pages/Setup.js";

type Phase = "loading" | "setup" | "ready";

/** Setup is needed until Slack tokens + an Azure model are configured. */
async function determinePhase(): Promise<Phase> {
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
    const provider = get("model.provider") || "azure";
    const hasModel =
      provider === "azure"
        ? !!(get("azure.apiKey") && get("azure.deployment") && (get("azure.resourceName") || get("azure.baseURL")))
        : provider === "openai"
          ? !!(get("openai.apiKey") && get("openai.model"))
          : provider === "anthropic"
            ? !!(get("anthropic.apiKey") && get("anthropic.model"))
            : provider === "bedrock"
              ? !!(get("bedrock.region") && get("bedrock.modelId"))
              : false;
    return hasSlack && hasModel ? "ready" : "setup";
  } catch {
    return "setup";
  }
}

function AppRouter(): JSX.Element {
  const { session, loading, signOut } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [forceSetup, setForceSetup] = useState(false);
  const [checkKey, setCheckKey] = useState(0);

  useEffect(() => {
    if (loading || !session) return;
    setPhase("loading");
    void determinePhase().then(setPhase);
  }, [loading, session, checkKey]);

  if (loading || (phase === "loading" && session)) {
    return (
      <div className="splash">
        <img src="/assets/tino-logo.png" alt="tino" className="splash-logo" />
        <div className="splash-wordmark">tino</div>
        <div className="splash-step">loading…</div>
      </div>
    );
  }

  if (!session) return <Login />;

  if (phase === "setup" || forceSetup) {
    return (
      <Setup
        onComplete={() => {
          setForceSetup(false);
          setCheckKey((k) => k + 1);
        }}
      />
    );
  }

  return <Chat session={session} signOut={signOut} onSetup={() => setForceSetup(true)} />;
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
