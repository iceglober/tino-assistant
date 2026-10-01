import { type JSX, useEffect, useRef, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { View } from "../App.js";
import { chatSend, type Session, type SetupStatus } from "../lib/api.js";

interface Msg {
  role: "user" | "tino";
  text: string;
}

/**
 * The chat box — the ready-phase home. Talk to Tino from the browser; it runs
 * the same agent path as Slack, keyed to the signed-in user, so it shares that
 * user's tools and conversation history.
 */
export function Chat({
  session,
  status,
  signOut,
  onNavigate,
}: {
  session: Session;
  status: SetupStatus;
  signOut: () => Promise<void>;
  onNavigate: (view: View) => void;
}): JSX.Element {
  const isAdmin = session.user.role === "admin";
  const toast = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Surface the Google OAuth callback result (google-oauth.ts redirects with ?oauth=…).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (!oauth) return;
    if (oauth === "success") toast.show("Google connected — Gmail + Calendar are live", "ok");
    else toast.show(`Google connect: ${oauth}`, "err");
    window.history.replaceState({}, "", window.location.pathname);
  }, [toast]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setSending(true);
    try {
      const reply = await chatSend(text);
      setMessages((m) => [...m, { role: "tino", text: reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "tino", text: `⚠️ ${(err as Error).message}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-root">
      <header className="chat-header">
        <div className="logo-block">
          <img src="/assets/tino-logo.png" alt="tino" className="chat-logo" />
          <span className="logo-wordmark">tino</span>
        </div>
        <div className="chat-header-actions">
          {status.googleConnect ? (
            <a className="btn-ghost" href="/api/oauth/google/authorize">
              connect Google
            </a>
          ) : null}
          {status.kb ? (
            <button className="btn-ghost" type="button" onClick={() => onNavigate("knowledge")}>
              knowledge
            </button>
          ) : null}
          <button className="btn-ghost" type="button" onClick={() => onNavigate("tools")}>
            tools
          </button>
          {isAdmin ? (
            <>
              <button className="btn-ghost" type="button" onClick={() => onNavigate("users")}>
                users
              </button>
              <button className="btn-ghost" type="button" onClick={() => onNavigate("setup")}>
                settings
              </button>
            </>
          ) : null}
          <span className="chat-email">{session.user.email}</span>
          <button className="btn-ghost" type="button" onClick={() => void signOut()}>
            sign out
          </button>
        </div>
      </header>

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>say hi to tino.</p>
            <p className="chat-empty-sub">ask about your inbox, calendar, or a Slack channel.</p>
            {status.slackConnect ? (
              <p className="chat-empty-sub">
                to let tino read your own Slack DMs and private channels, DM it <code>connect</code> in Slack.
              </p>
            ) : null}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`chat-msg chat-msg-${m.role}`}>
              <div className="chat-bubble">{m.text}</div>
            </div>
          ))
        )}
        {sending ? (
          <div className="chat-msg chat-msg-tino">
            <div className="chat-bubble chat-bubble-thinking">thinking…</div>
          </div>
        ) : null}
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="message tino…"
          autoComplete="off"
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={sending || !input.trim()}>
          send
        </button>
      </form>
    </div>
  );
}
