/**
 * Domain entities and value objects. Pure: no I/O, no framework or SDK imports.
 * Everything the business logic reasons about lives here.
 */

// ── Identity ──────────────────────────────────────────────────────────────────

/** External identity providers we support. */
export type IdentityProvider = "slack" | "google" | "email";

/** The canonical per-user record. Keyed by `id` (a UUID). */
export interface TinoUser {
  /** UUID — the canonical tino-side id for this user. */
  id: string;
  /** Lowercased on write. */
  email: string;
  /** Display name; from the google profile or slack `users.info`. */
  name?: string;
  /** First user is `admin`; subsequent auto-provisioned users are `member`. */
  role: "admin" | "member";
  /** `active` (default), `invited` (pre-link), `suspended` (admin action). */
  status: "active" | "invited" | "suspended";
  /** Denormalized pointer to the linked slack identity, or null. */
  slackUserId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One link between a tino user and an external identity, keyed on (provider, externalId). */
export interface Identity {
  provider: IdentityProvider;
  /** slack user id (e.g. `U01234ABCDE`) OR google email (lowercased). */
  externalId: string;
  tinoUserId: string;
  /** epoch ms when this identity was linked. */
  linkedAt: number;
}

/** Reserved synthetic user id for system-driven paths where no real user is the trigger. */
export const SYSTEM_USER_ID = "SYSTEM" as const;

/** A resolved user id: either a real tino-UUID or the synthetic `SYSTEM` sentinel. */
export type ResolvedUserId = string | typeof SYSTEM_USER_ID;

/**
 * Raised when `link` is called for a `(provider, externalId)` that is already
 * taken. Callers treat it as the "already linked" signal during idempotent retries.
 */
export class IdentityLinkConflictError extends Error {
  constructor(provider: IdentityProvider, externalId: string) {
    super(`identity (${provider}, ${externalId}) is already linked`);
    this.name = "IdentityLinkConflictError";
  }
}

// ── Credentials ───────────────────────────────────────────────────────────────

/** Stored per (userId, capabilityId) — JSON blob, credentials encrypted at rest. */
export interface CapabilityConfig {
  enabled: boolean;
  credentials: Record<string, string>; // e.g. { clientId, clientSecret, refreshToken }
  settings: Record<string, unknown>;
}

// ── Access decisions ────────────────────────────────────────────────────────

/**
 * The outcome of resolving an inbound sender to a tino user. Either they map to
 * a user we should serve, or they're rejected with a message to show them.
 */
export type ResolveResult = { ok: true; userId: string } | { ok: false; message: string };
