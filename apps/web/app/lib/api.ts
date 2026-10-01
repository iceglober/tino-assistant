/**
 * A small typed client for @tino/server. Every shape comes from
 * @tino/contracts; org data lives under /api/orgs/:slug.
 *
 * Errors arrive as `{ error, message? }` and surface as `ApiError`. A 401
 * means the session ended: the browser goes to /signin (and comes back after).
 */
import type {
  AccessPolicy,
  ApplyResult,
  ChatReply,
  ConnectionProvider,
  CreateOrgBody,
  CreateOrgResponse,
  DontLearnFromSaved,
  DontLearnFromView,
  GmailExclusion,
  GoogleAccess,
  GoogleSetup,
  InstallStart,
  InviteBody,
  KbActivityEvent,
  KbBrowsePage,
  KbFactKind,
  KbItem,
  KbKnowledgePage,
  KbScope,
  KbStatus,
  KbTopic,
  ManagedUser,
  McpScope,
  McpServerInput,
  McpServerList,
  McpTestResult,
  Me,
  OrgOverview,
  OrgSetupStatus,
  OrgSummary,
  PlatformInfo,
  SettingsUpdate,
  SettingsView,
  SlackSetup,
  SlugAvailability,
  UserPatch,
} from "@tino/contracts";

export class ApiError extends Error {
  readonly status: number;
  /** The server's machine-readable code, e.g. `verify_email`, `unauthorized`. */
  readonly error: string;

  constructor(status: number, error: string, message?: string) {
    super(message || error || `request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.error = error;
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;

/** Where /signin should send the person after they sign back in. */
export function signinUrl(next?: string): string {
  const here = next ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
  return here && here !== "/" && !here.startsWith("/signin") ? `/signin?next=${encodeURIComponent(here)}` : "/signin";
}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Return the 401 as an ApiError instead of redirecting (for "am I signed in?" checks). */
  allow401?: boolean;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network", "can't reach tino — check your connection and try again.");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const body = (data ?? {}) as { error?: unknown; message?: unknown };
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";
    const err = new ApiError(res.status, code, message || res.statusText);
    if (res.status === 401 && !opts.allow401 && typeof window !== "undefined") {
      window.location.assign(signinUrl());
    }
    throw err;
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined | null>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

// ── Account (no org) ─────────────────────────────────────────────────────────

export const accountApi = {
  platform: () => request<PlatformInfo>("GET", "/api/platform"),
  me: (signal?: AbortSignal) => request<Me>("GET", "/api/me", { allow401: true, signal }),
  createOrg: (body: CreateOrgBody) => request<CreateOrgResponse>("POST", "/api/orgs", { body }),
  slugAvailable: (slug: string, signal?: AbortSignal) =>
    request<SlugAvailability>("GET", `/api/orgs/slug-available${qs({ slug })}`, { signal }),
  join: (slug: string) => request<OrgSummary>("POST", `/api/orgs/${encodeURIComponent(slug)}/join`),
};

// ── Org-scoped ───────────────────────────────────────────────────────────────

export interface Items<T> {
  items: T[];
}

export interface KnowledgeQuery {
  scope: KbScope;
  kind?: KbFactKind;
  subject?: string;
  limit?: number;
  offset?: number;
}

export interface BrowseQuery {
  scope: KbScope;
  q?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export function orgApi(slug: string) {
  const base = `/api/orgs/${encodeURIComponent(slug)}`;
  const get = <T>(path: string, signal?: AbortSignal) => request<T>("GET", base + path, { signal });
  const send = <T>(method: string, path: string, body?: unknown) => request<T>(method, base + path, { body });

  return {
    overview: (signal?: AbortSignal) => get<OrgOverview>("", signal),

    // settings (admin)
    settings: (signal?: AbortSignal) => get<SettingsView>("/settings", signal),
    saveSettings: (body: SettingsUpdate) => send<{ ok: true }>("PUT", "/settings", body),
    apply: () => send<ApplyResult>("POST", "/settings/apply"),
    rebuildKb: () => send<{ ok: true; status: OrgSetupStatus }>("POST", "/kb/rebuild"),

    // members (admin)
    users: (signal?: AbortSignal) => get<Items<ManagedUser>>("/users", signal),
    invite: (body: InviteBody) => send<unknown>("POST", "/users", body),
    patchUser: (id: string, patch: UserPatch) => send<unknown>("PATCH", `/users/${encodeURIComponent(id)}`, patch),
    cancelInvite: (id: string) => send<unknown>("DELETE", `/users/${encodeURIComponent(id)}`),
    access: (signal?: AbortSignal) => get<AccessPolicy>("/users/access", signal),
    saveAccess: (policy: AccessPolicy) => send<AccessPolicy>("PUT", "/users/access", policy),

    // MCP
    mcpServers: (signal?: AbortSignal) => get<McpServerList>("/mcp/servers", signal),
    saveMcp: (scope: McpScope, id: string, input: McpServerInput) =>
      send<unknown>("PUT", `/mcp/servers/${scope}/${encodeURIComponent(id)}`, input),
    deleteMcp: (scope: McpScope, id: string) =>
      send<{ ok: boolean; removed: boolean }>("DELETE", `/mcp/servers/${scope}/${encodeURIComponent(id)}`),
    testMcp: (body: McpServerInput & { scope: McpScope; id?: string }) =>
      send<McpTestResult>("POST", "/mcp/test", body),

    // chat
    chat: (text: string) => send<ChatReply>("POST", "/chat", { text }),

    // knowledge base
    kbStatus: (signal?: AbortSignal) => get<KbStatus>("/kb/status", signal),
    knowledge: (q: KnowledgeQuery, signal?: AbortSignal) =>
      get<KbKnowledgePage>(`/kb/knowledge${qs({ ...q })}`, signal),
    topics: (scope: KbScope, signal?: AbortSignal) => get<Items<KbTopic>>(`/kb/topics${qs({ scope })}`, signal),
    topicChunks: (scope: KbScope, id: string, signal?: AbortSignal) =>
      get<Items<KbItem>>(`/kb/topics/${encodeURIComponent(id)}/chunks${qs({ scope })}`, signal),
    browse: (q: BrowseQuery, signal?: AbortSignal) => get<KbBrowsePage>(`/kb/browse${qs({ ...q })}`, signal),
    activity: (limit = 80, signal?: AbortSignal) => get<Items<KbActivityEvent>>(`/kb/activity${qs({ limit })}`, signal),
    dontLearnFrom: (signal?: AbortSignal) => get<DontLearnFromView>("/kb/dont-learn-from", signal),
    saveDontLearnFrom: (gmail: GmailExclusion[]) => send<DontLearnFromSaved>("PUT", "/kb/dont-learn-from", { gmail }),

    // connections
    disconnect: (provider: ConnectionProvider) => send<{ ok: true }>("DELETE", `/connections/${provider}`),
    googleSetup: (signal?: AbortSignal) => get<GoogleSetup>("/google/setup", signal),
    slackSetup: (signal?: AbortSignal) => get<SlackSetup>("/slack/setup", signal),
    slackInstall: () => send<InstallStart>("POST", "/slack/install"),
  };
}

export type OrgApi = ReturnType<typeof orgApi>;

/** Full-page navigations (the server redirects to the provider and back). */
export const connectUrls = {
  google: (slug: string, access: GoogleAccess) =>
    `/api/orgs/${encodeURIComponent(slug)}/connections/google/start${qs({ access })}`,
  slack: (slug: string) => `/api/orgs/${encodeURIComponent(slug)}/connections/slack/start`,
};
