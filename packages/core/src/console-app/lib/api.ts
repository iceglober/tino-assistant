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
  kind?: 'string' | 'string[]';
  secret?: boolean;
  placeholder?: string;
  value?: string;
}

export interface CapabilityEntry {
  id: string;
  displayName: string;
  enabled: boolean;
  fields: CapabilityField[];
  findWork?: { enabled: boolean; intervalMinutes: number; lastScanAt?: number };
  updatedAt?: number;
}

export interface HealthResponse {
  ok: boolean;
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
    super('unauthorized');
    this.name = 'UnauthorizedError';
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
  const r = await fetch('/api/config', { credentials: 'include' });
  return unwrap<ConfigEntry[]>(r);
}

export async function putConfig(key: string, value: unknown): Promise<{ ok: true; key: string }> {
  const r = await fetch(`/api/config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ value }),
  });
  return unwrap(r);
}

export async function deleteConfig(key: string): Promise<{ ok: true; deleted: boolean }> {
  const r = await fetch(`/api/config/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return unwrap(r);
}

export async function getHealth(): Promise<HealthResponse> {
  const r = await fetch('/api/health', { credentials: 'include' });
  return unwrap<HealthResponse>(r);
}

export async function getCapabilities(): Promise<CapabilityEntry[]> {
  const r = await fetch('/api/capabilities', { credentials: 'include' });
  return unwrap<CapabilityEntry[]>(r);
}

export async function putCapability(
  id: string,
  data: unknown,
): Promise<{ ok: true; id: string }> {
  const r = await fetch(`/api/capabilities/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return unwrap(r);
}

export async function getCompliance(): Promise<unknown> {
  const r = await fetch('/api/compliance', { credentials: 'include' });
  return unwrap(r);
}

export interface Session {
  user: { id: string; email: string; name?: string };
}

export async function getSession(): Promise<Session | null> {
  try {
    const r = await fetch('/api/auth/get-session', { credentials: 'include' });
    if (!r.ok) return null;
    const data = (await r.json()) as Session | null;
    return data && data.user ? data : null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  } catch {
    /* ignore */
  }
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
    const r = await fetch('/api/reload/slack', { method: 'POST', credentials: 'include' });
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
    const r = await fetch('/api/reload/capabilities', { method: 'POST', credentials: 'include' });
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
    const r = await fetch('/api/admin/restart', { method: 'POST', credentials: 'include' });
    if (r.status === 401) throw new UnauthorizedError();
    return (await r.json()) as ReloadResult;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    return { ok: false, error: (err as Error).message };
  }
}
