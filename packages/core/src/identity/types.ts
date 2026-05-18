/**
 * Identity-model types shared by the core user/identity stores, the resolver
 * (a3+), and the migration (a6).
 *
 * Wave 0 introduces these alongside the existing single-user world. Nothing
 * outside the identity module reads them yet — wave 3 wires the resolver into
 * the slack handler.
 */

/** External identity providers we support. */
export type IdentityProvider = "slack" | "google";

/**
 * The canonical per-user record. Keyed by `id` (a UUID, generated at
 * provisioning time). External identities (slack user id, google email) are
 * stored separately in the `Identity` table; `slackUserId` here is a
 * denormalized pointer for fast lookups in slack-only paths during the
 * transition.
 */
export interface TinoUser {
  /** UUID — the canonical tino-side id for this user. */
  id: string;
  /** Lowercased on write. */
  email: string;
  /** Display name; populated from google profile or slack `users.info`. */
  name?: string;
  /** First user is `admin`; subsequent auto-provisioned users are `member`. */
  role: "admin" | "member";
  /** `active` (default), `invited` (pre-link), `suspended` (admin action). */
  status: "active" | "invited" | "suspended";
  /**
   * Denormalized pointer to the linked slack identity, or null if none is
   * linked. Allows slack-only paths to skip the identity-table join.
   */
  slackUserId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * One link between a tino user and an external identity. Composite key on
 * (provider, externalId). `tinoUserId` references `TinoUser.id`.
 */
export interface Identity {
  provider: IdentityProvider;
  /** slack user id (e.g. `U01234ABCDE`) OR google email (lowercased). */
  externalId: string;
  tinoUserId: string;
  /** epoch ms when this identity was linked. */
  linkedAt: number;
}

/**
 * Reserved synthetic user id used by find-work pollers and other system-driven
 * paths where no real user is the trigger. Never a real `TinoUser.id`.
 */
export const SYSTEM_USER_ID = "SYSTEM" as const;

/**
 * A resolved user id is either a real tino-UUID or the synthetic `SYSTEM`
 * sentinel. Callers that accept this type must handle the SYSTEM case
 * explicitly (typically by skipping per-user credential reads).
 */
export type ResolvedUserId = string | typeof SYSTEM_USER_ID;
