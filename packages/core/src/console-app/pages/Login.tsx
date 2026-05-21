import { type JSX, useState } from "react";

const isLocalhost =
  typeof window !== "undefined" && window.location.hostname === "localhost";

export function Login(): JSX.Element {
  const [error, setError] = useState("");

  if (isLocalhost) return <LocalLogin error={error} setError={setError} />;
  return <GoogleLogin error={error} setError={setError} />;
}

function GoogleLogin({
  error,
  setError,
}: { error: string; setError: (e: string) => void }): JSX.Element {
  const signIn = async (): Promise<void> => {
    setError("");
    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
        redirect: "manual",
      });
      if (res.status === 200) {
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      } else if (res.type === "opaqueredirect" || res.status === 302) {
        const location = res.headers.get("location");
        if (location) {
          window.location.href = location;
          return;
        }
      }
      setError("sign in failed — check console");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/assets/tino-logo.png" alt="tino" className="login-logo" />
        <h1 className="login-heading">tino</h1>
        <p className="login-sub">sign in with your Google account to continue</p>
        <button className="login-btn" type="button" onClick={() => void signIn()}>
          sign in with Google
        </button>
        {error ? <p className="login-error">{error}</p> : <p className="login-error" />}
      </div>
    </div>
  );
}

function LocalLogin({
  error,
  setError,
}: { error: string; setError: (e: string) => void }): JSX.Element {
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setError("");
    setSubmitting(true);
    try {
      const endpoint =
        mode === "sign-up"
          ? "/api/auth/sign-up/email"
          : "/api/auth/sign-in/email";
      const body =
        mode === "sign-up" ? { email, password, name } : { email, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      setError(data?.message ?? `${mode} failed (${res.status})`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/assets/tino-logo.png" alt="tino" className="login-logo" />
        <h1 className="login-heading">tino</h1>
        <p className="login-sub">
          {mode === "sign-up"
            ? "create a local account"
            : "sign in to your local account"}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="login-form"
        >
          {mode === "sign-up" && (
            <input
              type="text"
              placeholder="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="login-input"
              autoComplete="name"
            />
          )}
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="login-input"
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="login-input"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={8}
          />
          <button className="login-btn" type="submit" disabled={submitting}>
            {submitting ? "..." : mode === "sign-up" ? "create account" : "sign in"}
          </button>
        </form>
        <p className="login-hint">
          {mode === "sign-up" ? (
            <>
              first account becomes admin &middot;{" "}
              <button
                type="button"
                className="login-link"
                onClick={() => {
                  setMode("sign-in");
                  setError("");
                }}
              >
                already have an account?
              </button>
            </>
          ) : (
            <button
              type="button"
              className="login-link"
              onClick={() => {
                setMode("sign-up");
                setError("");
              }}
            >
              create a new account
            </button>
          )}
        </p>
        {error ? <p className="login-error">{error}</p> : <p className="login-error" />}
      </div>
    </div>
  );
}
