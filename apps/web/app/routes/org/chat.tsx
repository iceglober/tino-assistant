import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Markdown } from "../../components/chat/Markdown";
import { RouteError } from "../../components/RouteError";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { useOrg } from "../../layouts/app-shell";
import { orgApi } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import type { Route } from "./+types/chat";

export const meta: Route.MetaFunction = () => [{ title: "chat · tino" }];

interface Message {
  id: number;
  role: "me" | "tino";
  text: string;
  /** For my messages: still waiting, or the send failed. */
  state?: "sending" | "failed";
  error?: string;
}

/** Conversations survive moving between pages (not reloads); tino keeps its own history server-side. */
const threads = new Map<string, Message[]>();
let nextId = 1;

const SUGGESTIONS = [
  "what's on my calendar tomorrow?",
  "anything in my inbox i need to answer today?",
  "what did we decide about the launch date?",
  "summarize what happened in Slack while i was out",
];

export default function Chat() {
  const { slug, org, isAdmin } = useOrg();
  const [messages, setMessages] = useState<Message[]>(() => threads.get(slug) ?? []);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    threads.set(slug, messages);
  }, [slug, messages]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the list or the typing indicator changes
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, waiting]);

  const deliver = async (id: number, text: string) => {
    setWaiting(true);
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, state: "sending", error: undefined } : x)));
    try {
      const { reply } = await orgApi(slug).chat(text);
      setMessages((m) => [
        ...m.map((x) => (x.id === id ? { ...x, state: undefined } : x)),
        { id: nextId++, role: "tino", text: reply },
      ]);
    } catch (err) {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, state: "failed", error: errorMessage(err) } : x)));
    } finally {
      setWaiting(false);
      inputRef.current?.focus();
    }
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || waiting) return;
    const id = nextId++;
    setMessages((m) => [...m, { id, role: "me", text: t, state: "sending" }]);
    setDraft("");
    void deliver(id, t);
  };

  const noModel = !org.status.model;

  return (
    <div className="chat">
      <header className="chat__head">
        <h1 className="chat__title">chat</h1>
        <p className="small muted">same tino as in Slack — your tools, your connections, your history.</p>
      </header>

      {noModel ? (
        <Notice tone="warn" title="tino can't reply yet">
          <p>
            no model is configured.{" "}
            {isAdmin ? <Link to={`/${slug}/settings/model`}>add one in settings</Link> : "ask an admin to add one."}
          </p>
        </Notice>
      ) : null}

      <div className="chat__log" ref={logRef} role="log" aria-live="polite" aria-label="conversation">
        {messages.length === 0 ? (
          <div className="chat__empty">
            <img src="/tino-logo.png" alt="" width={44} height={44} />
            <p className="chat__hello">say hi to tino.</p>
            <p className="muted small">
              ask about your inbox, your calendar, or anything your team discussed in Slack.
            </p>
            <ul className="chips" aria-label="suggestions">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setDraft(s);
                      inputRef.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg msg--${m.role}${m.state === "failed" ? " msg--failed" : ""}`}>
              <span className="msg__who">{m.role === "me" ? "you" : "tino"}</span>
              <div className="msg__body">{m.role === "tino" ? <Markdown text={m.text} /> : <p>{m.text}</p>}</div>
              {m.state === "failed" ? (
                <div className="msg__fail" role="alert">
                  <span>✕ not delivered — {m.error}</span>
                  <Button size="sm" variant="ghost" onClick={() => void deliver(m.id, m.text)} disabled={waiting}>
                    retry
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
        {waiting ? (
          <div className="msg msg--tino msg--typing" role="status">
            <span className="msg__who">tino</span>
            <div className="msg__body">
              <span className="visually-hidden">tino is thinking…</span>
              <span className="dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="chat-input" className="visually-hidden">
          message tino
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="composer__input"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="message tino…"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the chat box is the page's single purpose
          autoFocus
        />
        <Button type="submit" variant="primary" disabled={!draft.trim() || waiting}>
          send
        </Button>
        <p className="composer__hint small muted" aria-hidden="true">
          enter to send · shift+enter for a new line
        </p>
      </form>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
