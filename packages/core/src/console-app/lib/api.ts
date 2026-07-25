/**
 * Tiny fetch-based API client for the console.
 *
 * Everything is gated by the server's auth middleware; a 401 means "no session"
 * and the SPA falls back to <Login>. Only the burned-down surface remains:
 * config (Slack/Azure/Google keys), session, hot-reload, and the chat box.
 */

export interface ConfigEntry {
  key: string;
  value: string;
  updatedAt?: string;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Config ──────────────────────────────────────────────────────────────────

export async function getConfig(): Promise<ConfigEntry[]> {
  const r = await fetch("/api/config", { credentials: "include" });
  return unwrap<ConfigEntry[]>(r);
}

export async function putConfig(key: string, value: unknown): Promise<{ ok: true; key: string }> {
  const r = await fetch(`/api/config/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ value }),
  });
  return unwrap(r);
}

// ── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  user: { id: string; email: string; name?: string; role?: "admin" | "member"; slackUserId?: string | null };
}

export async function getMe(): Promise<{
  id: string;
  email: string;
  role: "admin" | "member";
  status: string;
  slackUserId?: string | null;
} | null> {
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()) as {
      id: string;
      email: string;
      role: "admin" | "member";
      status: string;
      slackUserId?: string | null;
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const r = await fetch("/api/auth/get-session", { credentials: "include" });
    if (!r.ok) return null;
    const data = (await r.json()) as Session | null;
    if (!data?.user) return null;

    const me = await getMe();
    if (me) {
      data.user.id = me.id;
      data.user.role = me.role;
      data.user.slackUserId = me.slackUserId;
    }
    return data;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
  } catch {
    /* ignore */
  }
}

// ── Hot-reload ──────────────────────────────────────────────────────────────
//
// Reload routes return `{ ok, error? }` with HTTP 200 even on user-visible
// failures (bad tokens) so a server bug (5xx) is distinguishable from a
// "wrong token" (200 + ok:false). Toast `error` when `ok` is false.

export interface ReloadResult {
  ok: boolean;
  error?: string;
}

/** Reconnect Slack + rebuild the Azure model with whatever config is now saved. */
export async function reloadSlack(): Promise<ReloadResult> {
  try {
    const r = await fetch("/api/reload/slack", { method: "POST", credentials: "include" });
    if (r.status === 401) throw new UnauthorizedError();
    return (await r.json()) as ReloadResult;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    return { ok: false, error: (err as Error).message };
  }
}

// ── Knowledge base ──────────────────────────────────────────────────────────

export interface KbCycleSummary {
  at: number;
  principals: number;
  skipped: number;
  chunksUpserted: number;
  apiCalls: number;
  errors: number;
  ms: number;
}

export interface KbScopeStats {
  chunks: number;
  oldestMs: number | null;
  newestMs: number | null;
  bySource: Array<{ source: string; chunks: number; newestMs: number | null }>;
}

export interface KbPrincipal {
  scope: "workspace" | "user";
  userId: string;
  source: "slack" | "gmail";
  status: "active" | "paused_auth" | "paused_error" | "disabled";
  backfillDone: boolean;
  lastCycleAt?: number;
  pausedAt?: number;
  lastError?: string;
}

export interface KbStatus {
  enabled: boolean;
  indexer?: {
    running: boolean;
    intervalMs: number;
    startedAt?: number;
    nextRunAt?: number;
    lastCycle?: KbCycleSummary;
    cyclesCompleted: number;
  };
  scopes?: { workspace: KbScopeStats; mine: KbScopeStats };
  principals?: KbPrincipal[];
}

export interface KbItem {
  id?: string;
  text: string;
  source: string;
  sourceRef?: string;
  ts: string;
  permalink?: string;
  meta: Record<string, unknown>;
  indexedAt?: string;
  score?: number;
  sim?: number;
}

export async function getKbStatus(): Promise<KbStatus> {
  const r = await fetch("/api/kb/status", { credentials: "include" });
  return unwrap<KbStatus>(r);
}

export async function browseKb(params: {
  scope: "workspace" | "mine";
  q?: string;
  source?: string;
  limit?: number;
  offset?: number;
}): Promise<{ mode: "recent" | "search"; total: number; items: KbItem[] }> {
  const qs = new URLSearchParams({ scope: params.scope });
  if (params.q) qs.set("q", params.q);
  if (params.source) qs.set("source", params.source);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const r = await fetch(`/api/kb/browse?${qs}`, { credentials: "include" });
  return unwrap(r);
}

// ── Chat ────────────────────────────────────────────────────────────────────

/** Send one message to Tino and get the reply (same agent path as Slack). */
export async function chatSend(text: string): Promise<string> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ text }),
  });
  const data = await unwrap<{ reply: string }>(r);
  return data.reply;
}
