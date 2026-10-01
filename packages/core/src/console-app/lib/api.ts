/**
 * Tiny fetch-based API client for the console.
 *
 * Everything is gated by the server's auth middleware; a 401 means "no session"
 * and the SPA falls back to <Login>. Config, users, and hot-reload are
 * admin-only; status, chat, knowledge, and MCP servers work for everyone.
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
    let message = text;
    try {
      const body = JSON.parse(text) as { message?: string; error?: string };
      message = body.message ?? body.error ?? text;
    } catch {
      /* not JSON — show the text */
    }
    throw new Error(message || `${res.status} ${res.statusText}`);
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

// ── Status (any signed-in user) ─────────────────────────────────────────────

export interface SetupStatus {
  slack: boolean;
  model: boolean;
  slackConnect: boolean;
  googleConnect: boolean;
  kb: boolean;
  /** Setup keys provided by the deployment's environment (names only). */
  fromEnvironment: string[];
}

export async function getStatus(): Promise<SetupStatus> {
  const r = await fetch("/api/status", { credentials: "include" });
  return unwrap<SetupStatus>(r);
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) throw new UnauthorizedError();
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `${r.status} ${r.statusText}`);
  return data;
}

// ── Users (admin) ───────────────────────────────────────────────────────────

export interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
  status: "active" | "invited" | "suspended";
  slackLinked: boolean;
  connections: string[];
  createdAt: string;
}

export interface AccessPolicy {
  mode: "org-domain" | "invite-only";
  domain: string | null;
}

export const listUsers = (): Promise<{ items: ManagedUser[] }> => send("GET", "/api/users");
export const inviteUser = (email: string, role: "admin" | "member"): Promise<ManagedUser> =>
  send("POST", "/api/users", { email, role });
export const updateUser = (
  id: string,
  patch: { role?: "admin" | "member"; status?: "active" | "suspended" },
): Promise<ManagedUser> => send("PATCH", `/api/users/${encodeURIComponent(id)}`, patch);
export const getAccessPolicy = (): Promise<AccessPolicy> => send("GET", "/api/users/access");
export const setAccessPolicy = (policy: { mode: AccessPolicy["mode"]; domain?: string }): Promise<AccessPolicy> =>
  send("PUT", "/api/users/access", policy);

// ── MCP servers ─────────────────────────────────────────────────────────────

export type McpScope = "workspace" | "personal";
export type McpAuthKind = "none" | "bearer" | "header";

export interface McpServer {
  id: string;
  scope: McpScope;
  name: string;
  url: string;
  transport: "http" | "sse";
  auth: { kind: McpAuthKind; headerName?: string };
  enabled: boolean;
  /** Workspace servers only: may everyone see results (usable in channels) or only the asker. */
  resultsVisibleTo: "asker" | "workspace";
  hasToken: boolean;
}

export interface McpServerInput {
  name?: string;
  url?: string;
  transport?: "http" | "sse";
  auth?: { kind: McpAuthKind; headerName?: string };
  /** Omit to keep the stored token; "" clears it. */
  token?: string;
  enabled?: boolean;
  resultsVisibleTo?: "asker" | "workspace";
}

export const listMcpServers = (): Promise<{ canManageWorkspace: boolean; workspace: McpServer[]; personal: McpServer[] }> =>
  send("GET", "/api/mcp/servers");
export const saveMcpServer = (scope: McpScope, id: string, input: McpServerInput): Promise<McpServer> =>
  send("PUT", `/api/mcp/servers/${scope}/${encodeURIComponent(id)}`, input);
export const deleteMcpServer = (scope: McpScope, id: string): Promise<{ ok: boolean }> =>
  send("DELETE", `/api/mcp/servers/${scope}/${encodeURIComponent(id)}`);
export const testMcpServer = (
  input: McpServerInput & { id?: string; scope: McpScope },
): Promise<{ ok: boolean; tools?: string[]; error?: string }> => send("POST", "/api/mcp/test", input);

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

/** Rebuild console auth so a newly saved Google OAuth client takes effect. */
export async function reloadAuth(): Promise<ReloadResult> {
  try {
    const r = await fetch("/api/reload/auth", { method: "POST", credentials: "include" });
    return (await r.json()) as ReloadResult;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Knowledge base ──────────────────────────────────────────────────────────

export type KbScope = "workspace" | "private";

export interface KbCycleSummary {
  at: number;
  cycleId: string;
  principals: number;
  skipped: number;
  chunksUpserted: number;
  apiCalls: number;
  errors: number;
  factsCreated: number;
  factsUpdated: number;
  chunksDistilled: number;
  ms: number;
}

export interface KbScopeStats {
  chunks: number;
  oldestMs: number | null;
  newestMs: number | null;
  bySource: Array<{ source: string; chunks: number; newestMs: number | null }>;
  /** Chunks indexed but not yet distilled into facts. */
  pending: number;
  facts: number;
}

export interface KbPrincipal {
  scope: KbScope;
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
  /** False when no model is configured — nothing can be distilled. */
  distilling?: boolean;
  indexer?: {
    running: boolean;
    intervalMs: number;
    startedAt?: number;
    nextRunAt?: number;
    lastCycle?: KbCycleSummary;
    cyclesCompleted: number;
  };
  scopes?: { workspace: KbScopeStats; private: KbScopeStats };
  principals?: KbPrincipal[];
}

export type KbFactKind =
  | "project"
  | "person"
  | "problem"
  | "commitment"
  | "decision"
  | "preference"
  | "fact";

export interface KbEvidence {
  source: string;
  ts: string;
  permalink?: string;
  snippet: string;
}

export interface KbFact {
  id: string;
  kind: KbFactKind;
  subject: string;
  statement: string;
  detail?: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  evidence: KbEvidence[];
}

export interface KbTopic {
  id: string;
  label: string;
  summary: string;
  chunks: number;
  oldest: string | null;
  newest: string | null;
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

export interface KbActivityEvent {
  id: string;
  cycleId: string;
  at: string;
  scope: KbScope;
  userId: string;
  source: "slack" | "gmail" | "synthesis" | "topics";
  outcome: "ok" | "skipped" | "auth_error" | "error";
  chunksUpserted: number;
  apiCalls: number;
  ms: number;
  detail?: string;
  error?: string;
}

export async function getKbStatus(): Promise<KbStatus> {
  const r = await fetch("/api/kb/status", { credentials: "include" });
  return unwrap<KbStatus>(r);
}

export async function getKnowledge(params: {
  scope: KbScope;
  kind?: string;
  subject?: string;
  limit?: number;
}): Promise<{ total: number; kinds: Array<{ kind: KbFactKind; count: number }>; items: KbFact[] }> {
  const qs = new URLSearchParams({ scope: params.scope });
  if (params.kind) qs.set("kind", params.kind);
  if (params.subject) qs.set("subject", params.subject);
  if (params.limit) qs.set("limit", String(params.limit));
  const r = await fetch("/api/kb/knowledge?" + qs, { credentials: "include" });
  return unwrap(r);
}

export async function getKbTopics(scope: KbScope): Promise<{ items: KbTopic[] }> {
  const r = await fetch("/api/kb/topics?scope=" + scope, { credentials: "include" });
  return unwrap(r);
}

export async function getTopicChunks(scope: KbScope, topicId: string): Promise<{ items: KbItem[] }> {
  const r = await fetch("/api/kb/topics/" + topicId + "/chunks?scope=" + scope, { credentials: "include" });
  return unwrap(r);
}

export async function browseKb(params: {
  scope: KbScope;
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
  const r = await fetch("/api/kb/browse?" + qs, { credentials: "include" });
  return unwrap(r);
}

export async function getKbActivity(limit = 60): Promise<{ items: KbActivityEvent[] }> {
  const r = await fetch("/api/kb/activity?limit=" + limit, { credentials: "include" });
  return unwrap(r);
}

// ── Don't learn from ────────────────────────────────────────────────────────

export type GmailExclusion =
  | { kind: "gmailLabel"; labelId: string; name: string }
  | { kind: "gmailSearch"; query: string; name: string; fromFilterId?: string };

export interface DontLearnFromView {
  enabled?: false;
  exclusions: { gmail: GmailExclusion[] };
  gmailConnected: boolean;
  options: {
    labels: Array<{ id: string; name: string }>;
    filters: Array<{ id: string; description: string; query: string; labelIds: string[] }>;
  } | null;
  optionsError?: string;
}

export const getDontLearnFrom = (): Promise<DontLearnFromView> => send("GET", "/api/kb/dont-learn-from");
export const saveDontLearnFrom = (gmail: GmailExclusion[]): Promise<{ exclusions: { gmail: GmailExclusion[] }; appliesBy: number | null }> =>
  send("PUT", "/api/kb/dont-learn-from", { gmail });

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
