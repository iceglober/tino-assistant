/**
 * Tiny fetch-based API client for the console.
 *
 * Mirror: the JS fetch helpers at `console/html.ts:1538-1587`.
 *
 * - All routes are gated by Hono's auth middleware. A 401 means "no session";
 *   pages handle that by routing to <Login>.
 * - Sensitive write paths (config, capabilities) PUT a JSON body — match the
 *   shape the Hono routes expect (`{ value }` for config, raw object for
 *   capabilities).
 */

export interface ConfigEntry {
  key: string;
  value: string;
  updatedAt?: string;
}

export interface CapabilityField {
  key: string;
  label: string;
  target: string;
  kind?: "string" | "string[]";
  secret?: boolean;
  placeholder?: string;
  value?: string;
}

export interface CapabilityEntry {
  id: string;
  displayName: string;
  scope: "shared" | "private";
  enabled: boolean;
  fields: CapabilityField[];
  findWork?: { enabled: boolean; intervalMinutes: number; lastScanAt?: number };
  updatedAt?: number;
}

export interface HealthResponse {
  ok: boolean;
  authConfigured?: boolean;
  tools: string[];
  uptime: number;
  capabilities: Array<{
    id: string;
    toolCount?: number;
    lastFindWorkScanAt?: string;
    lastError?: string;
  }>;
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

export async function deleteConfig(key: string): Promise<{ ok: true; deleted: boolean }> {
  const r = await fetch(`/api/config/${encodeURIComponent(key)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return unwrap(r);
}

export async function getHealth(): Promise<HealthResponse> {
  const r = await fetch("/api/health", { credentials: "include" });
  return unwrap<HealthResponse>(r);
}

export async function getCapabilities(): Promise<CapabilityEntry[]> {
  const r = await fetch("/api/capabilities", { credentials: "include" });
  return unwrap<CapabilityEntry[]>(r);
}

export async function putCapability(id: string, data: unknown): Promise<{ ok: true; id: string }> {
  const r = await fetch(`/api/capabilities/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return unwrap(r);
}

export async function getUserCapabilities(userId: string): Promise<CapabilityEntry[]> {
  const r = await fetch(`/api/user-capabilities/${encodeURIComponent(userId)}`, {
    credentials: "include",
  });
  return unwrap<CapabilityEntry[]>(r);
}

export async function putUserCapability(
  userId: string,
  capabilityId: string,
  data: unknown,
): Promise<{ ok: true; userId: string; id: string }> {
  const r = await fetch(`/api/user-capabilities/${encodeURIComponent(userId)}/${encodeURIComponent(capabilityId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return unwrap(r);
}

export async function deleteUserCapability(
  userId: string,
  capabilityId: string,
): Promise<{ ok: true; userId: string; id: string }> {
  const r = await fetch(`/api/user-capabilities/${encodeURIComponent(userId)}/${encodeURIComponent(capabilityId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return unwrap(r);
}

export async function getCompliance(): Promise<unknown> {
  const r = await fetch("/api/compliance", { credentials: "include" });
  return unwrap(r);
}

export interface Session {
  user: { id: string; email: string; name?: string; role?: "admin" | "member"; slackUserId?: string | null };
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

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
  } catch {
    /* ignore */
  }
}

// ── Wave 4 — audit + user management ───────────────────────────────────────

export interface AuditEntryView {
  timestamp: number;
  userId: string;
  action: string;
  toolName?: string;
  status: "success" | "error" | "denied";
  errorMessage?: string;
}

export interface OrgUser {
  id: string;
  email: string;
  name?: string;
  role: "admin" | "member";
  status: "active" | "invited" | "suspended";
  slackUserId: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function getAuditEntries(params?: {
  userId?: string;
  action?: string;
  since?: number;
  limit?: number;
}): Promise<AuditEntryView[]> {
  const qs = new URLSearchParams();
  if (params?.userId) qs.set("userId", params.userId);
  if (params?.action) qs.set("action", params.action);
  if (params?.since) qs.set("since", String(params.since));
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/audit${qs.toString() ? `?${qs}` : ""}`;
  const r = await fetch(url, { credentials: "include" });
  const data = await unwrap<{ entries: AuditEntryView[] }>(r);
  return data.entries;
}

export async function getOrgUsers(): Promise<OrgUser[]> {
  const r = await fetch("/api/org/users", { credentials: "include" });
  const data = await unwrap<{ users: OrgUser[] }>(r);
  return data.users;
}

export async function patchOrgUser(
  userId: string,
  patch: { role?: string; status?: string },
): Promise<{ ok: boolean; user: OrgUser; error?: string }> {
  const r = await fetch(`/api/org/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  return unwrap(r);
}

export async function addOrgUser(data: {
  email: string;
  slackUserId?: string;
  role?: string;
}): Promise<{ ok: boolean; user: OrgUser }> {
  const r = await fetch("/api/org/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return unwrap(r);
}

// ── Wave 3 — hot-reload + admin restart ────────────────────────────────────
//
// Reload routes return `{ ok, error? }` with HTTP 200 even on user-visible
// failures (bad tokens, missing creds) so a server-bug 5xx is distinguishable
// from a "you typed the wrong token" 200. Callers should toast `error` when
// `ok` is false.

export interface ReloadResult {
  ok: boolean;
  error?: string;
}

/**
 * Wave 3.1 — POST /api/reload/slack. Tells the running tino process to
 * reconnect Slack with whatever tokens are currently in the config store.
 * Call AFTER saving slack.botToken / slack.appToken so the new values are
 * visible to the reconnect.
 */
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

/**
 * Wave 3.2 — POST /api/reload/capabilities. Tells the running tino process
 * to re-run the capability registry against the live config store. Call
 * AFTER saving any `capability.<id>` blob.
 */
export async function reloadCapabilities(): Promise<ReloadResult> {
  try {
    const r = await fetch("/api/reload/capabilities", { method: "POST", credentials: "include" });
    if (r.status === 401) throw new UnauthorizedError();
    return (await r.json()) as ReloadResult;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Wave 4 — POST /api/reload/auth. Hot-swaps the better-auth instance with
 * config from the DynamoDB store. Called after the setup wizard saves Google
 * OAuth credentials. Bypasses admin check during first boot (no auth configured).
 */
export async function reloadAuth(): Promise<ReloadResult> {
  try {
    const r = await fetch("/api/reload/auth", { method: "POST", credentials: "include" });
    if (r.status === 401) throw new UnauthorizedError();
    return (await r.json()) as ReloadResult;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Wave 3.4 — POST /api/admin/restart. Triggers an in-process shutdown;
 * ECS automatically restarts the task. Returns 202 + `{ ok: true }`
 * before the process exits, then the server takes ~100ms to actually exit.
 */
export async function restartTino(): Promise<ReloadResult> {
  try {
    const r = await fetch("/api/admin/restart", { method: "POST", credentials: "include" });
    if (r.status === 401) throw new UnauthorizedError();
    return (await r.json()) as ReloadResult;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    return { ok: false, error: (err as Error).message };
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export interface TaskItem {
  id: string;
  userId: string;
  description: string;
  scheduledAt: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function getTasks(status?: string): Promise<TaskItem[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const r = await fetch(`/api/tasks${qs}`, { credentials: "include" });
  const data = await unwrap<{ tasks: TaskItem[] }>(r);
  return data.tasks;
}

export async function cancelTask(id: string): Promise<{ ok: boolean }> {
  const r = await fetch(`/api/tasks/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  return unwrap<{ ok: boolean }>(r);
}

// ── Activity ──────────────────────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  type: string;
  summary: string;
  status: "success" | "error" | "denied";
  timestamp: number;
}

export async function getRecentActivity(limit = 50): Promise<ActivityItem[]> {
  const qs = limit !== 50 ? `?limit=${limit}` : "";
  const r = await fetch(`/api/activity/recent${qs}`, { credentials: "include" });
  const data = await unwrap<{ items: ActivityItem[] }>(r);
  return data.items;
}

// ── Privacy ────────────────────────────────────────────────────────────────

export interface PrivacyStatus {
  connectedCapabilities: string[];
  hasPrivacyConfig: boolean;
  existingConfig: PrivacyConfig | null;
}

export interface PrivacyConfig {
  version: 2;
  email?: { privateFolders: string[]; denyListedAddresses: string[] };
  messaging?: { denyListedConversationIds: string[]; denyListedUserIds: string[] };
  calendar?: { defaultVisibility: string; gateAllByDefault: boolean };
  lastReviewedAt: number;
}

export interface PrivacyLabel {
  name: string;
  itemCount: number;
  preChecked: boolean;
  examples?: string[];
}

export interface PrivacyContact {
  address: string;
  displayName?: string;
  itemCount: number;
  preChecked: boolean;
  examples?: string[];
}

export interface PrivacyConversation {
  id: string;
  participantId?: string;
  participantName?: string;
  itemCount: number;
  preChecked: boolean;
  examples?: string[];
}

export async function getPrivacyStatus(): Promise<PrivacyStatus> {
  const r = await fetch("/api/privacy/status", { credentials: "include" });
  if (!r.ok) throw new Error(`privacy status failed: ${r.status}`);
  return (await r.json()) as PrivacyStatus;
}

export async function getPrivacyLabels(): Promise<{ labels: PrivacyLabel[]; message?: string }> {
  const r = await fetch("/api/privacy/email/labels", { credentials: "include" });
  if (!r.ok) return { labels: [], message: "failed to load" };
  return (await r.json()) as { labels: PrivacyLabel[]; message?: string };
}

export async function getPrivacyContacts(): Promise<{ contacts: PrivacyContact[]; message?: string }> {
  const r = await fetch("/api/privacy/email/contacts", { credentials: "include" });
  if (!r.ok) return { contacts: [], message: "failed to load" };
  return (await r.json()) as { contacts: PrivacyContact[]; message?: string };
}

export async function getPrivacyDMs(): Promise<{ conversations: PrivacyConversation[]; message?: string }> {
  const r = await fetch("/api/privacy/messaging/dms", { credentials: "include" });
  if (!r.ok) return { conversations: [], message: "failed to load" };
  return (await r.json()) as { conversations: PrivacyConversation[]; message?: string };
}

export async function getPrivacyCalendarVisibility(): Promise<{
  defaultVisibility: string;
  calendars: Array<{ id: string; name: string }>;
  message?: string;
}> {
  const r = await fetch("/api/privacy/calendar/visibility", { credentials: "include" });
  if (!r.ok) return { defaultVisibility: "public", calendars: [], message: "failed to load" };
  return (await r.json()) as {
    defaultVisibility: string;
    calendars: Array<{ id: string; name: string }>;
    message?: string;
  };
}

export async function savePrivacySection(section: string, config: Record<string, unknown>): Promise<{ ok: boolean }> {
  const r = await fetch(`/api/privacy/complete/${encodeURIComponent(section)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
    credentials: "include",
  });
  if (!r.ok) throw new Error(`save failed: ${r.status}`);
  return (await r.json()) as { ok: boolean };
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export interface OrgRelationship {
  name: string;
  email?: string;
  relationship:
    | "reports-to"
    | "direct-report"
    | "peer"
    | "stakeholder"
    | "cross-functional"
    | "external"
    | "frequent-contact";
  context: string;
  interactionFrequency: string;
}

export interface Responsibility {
  title: string;
  description: string;
  timeHorizon: "daily" | "weekly" | "monthly" | "quarterly" | "ongoing";
  evidence: string;
}

export interface CommunicationStyle {
  summary: string;
  preferredChannels: string[];
  patterns: string[];
}

export interface TimeInvestment {
  category: string;
  estimatedPct: number;
  details: string;
}

export interface WorkPatterns {
  meetingLoad: string;
  peakHours: string;
  recurringCommitments: string[];
  timeInvestment: TimeInvestment[];
}

export interface DiscoveryResult {
  roleSummary: string;
  inferredTitle: string;
  inferredDepartment: string;
  orgRelationships: OrgRelationship[];
  responsibilities: Responsibility[];
  communicationStyle: CommunicationStyle;
  workPatterns: WorkPatterns;
  painPoints: string[];
  suggestions: Array<{ title: string; description: string; capabilityId?: string }>;
  analyzedAt: number;
  dataSourcesUsed: string[];
}

export interface DiscoveryProgress {
  phase: "email" | "calendar" | "slack" | "analysis" | "done";
  pct: number;
  message: string;
}

export async function getSlackOAuthStatus(): Promise<{ configured: boolean; connected: boolean }> {
  const r = await fetch("/api/oauth/slack/status", { credentials: "include" });
  return unwrap<{ configured: boolean; connected: boolean }>(r);
}

export async function getUserPreferences(): Promise<Array<{ key: string; value: string }>> {
  const r = await fetch("/api/preferences", { credentials: "include" });
  return unwrap<Array<{ key: string; value: string }>>(r);
}

export async function getDiscoveryResult(): Promise<DiscoveryResult | null> {
  const r = await fetch("/api/discovery/result", { credentials: "include" });
  const data = await unwrap<{ result: DiscoveryResult | null }>(r);
  return data.result;
}

export function startDiscovery(
  onProgress: (p: DiscoveryProgress) => void,
  onResult: (r: DiscoveryResult) => void,
  onError: (e: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch("/api/discovery/run", {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `discovery failed: ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (currentEvent === "progress") onProgress(parsed as DiscoveryProgress);
              else if (currentEvent === "result") onResult(parsed as DiscoveryResult);
              else if (currentEvent === "error") onError(new Error((parsed as { error: string }).error));
            } catch {
              /* skip malformed frames */
            }
            currentEvent = "";
          } else if (line === "") {
            currentEvent = "";
          }
        }
      }
    })
    .catch((err) => {
      if ((err as Error).name !== "AbortError") onError(err as Error);
    });

  return controller;
}

// ── Privacy scan ──────────────────────────────────────────────────────────────

export interface ScanSuggestion {
  id: string;
  sensitive: boolean;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface ScanResult {
  email?: {
    labels: ScanSuggestion[];
    contacts: ScanSuggestion[];
  };
  messaging?: {
    conversations: ScanSuggestion[];
  };
  scannedAt: number;
}

export interface ScanProgress {
  phase: "email-labels" | "email-contacts" | "messaging" | "done";
  pct: number;
  message: string;
}

export function startPrivacyScan(
  onProgress: (p: ScanProgress) => void,
  onResult: (r: ScanResult) => void,
  onError: (e: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch("/api/privacy/scan", {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `scan failed: ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (currentEvent === "progress") onProgress(parsed as ScanProgress);
              else if (currentEvent === "result") onResult(parsed as ScanResult);
              else if (currentEvent === "error") onError(new Error((parsed as { error: string }).error));
            } catch {
              /* skip malformed frames */
            }
            currentEvent = "";
          } else if (line === "") {
            currentEvent = "";
          }
        }
      }
    })
    .catch((err) => {
      if ((err as Error).name !== "AbortError") onError(err as Error);
    });

  return controller;
}
