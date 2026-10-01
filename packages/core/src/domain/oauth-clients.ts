/**
 * Whose OAuth client a connection uses: the org's own, or one tino operates.
 *
 * Reading someone's mail or Slack history through *tino's* OAuth app makes tino
 * the app the provider audits — Google's restricted-scope verification plus an
 * annual CASA assessment for Gmail, Slack Marketplace review for usable rate
 * limits. Reading it through an app the *customer* owns (a Google "Internal"
 * client in their Workspace, a Slack app created in their own workspace) puts
 * none of that on tino. So the default is "bring your own client", and a
 * platform client is offered only for the access its approval level covers.
 *
 * The rule is the same for every provider:
 *
 *   1. The org's own client, when it has one, unless the org asked for the
 *      managed client and that client may serve it.
 *   2. Otherwise the platform's client, when its approval covers what the
 *      capability needs, the org may use it, and its user cap isn't reached.
 *   3. Otherwise nothing, with a reason the console can show.
 *
 * Every stored credential records which client issued it (`OAuthClientRef`),
 * because a refresh token only refreshes against the client that minted it.
 * Moving an org between clients is a reconnect, never a silent swap.
 */

export type OAuthProvider = "google" | "slack";

/**
 * How far a provider has vetted an OAuth app. Ordered: each level covers the
 * ones before it.
 *
 * - `none`     — unvetted. Google: unverified (warning screen, 100-user cap).
 *                Slack: distributed outside the Marketplace (history reads
 *                throttled to 1 request/minute).
 * - `verified` — Google: brand + sensitive-scope verification (Calendar).
 * - `assessed` — Google: restricted scopes approved with a CASA assessment
 *                (Gmail). Slack: approved for the Slack Marketplace.
 */
export type ApprovalLevel = "none" | "verified" | "assessed";

const LEVELS: readonly ApprovalLevel[] = ["none", "verified", "assessed"];
export const covers = (have: ApprovalLevel, need: ApprovalLevel): boolean =>
  LEVELS.indexOf(have) >= LEVELS.indexOf(need);

/** What each capability needs from the client that serves it. */
export const REQUIRED_APPROVAL: Record<string, { provider: OAuthProvider; level: ApprovalLevel }> = {
  // Sign-in only asks for openid/email/profile — no review beyond branding.
  "google.signin": { provider: "google", level: "none" },
  "google.calendar": { provider: "google", level: "verified" },
  "google.gmail": { provider: "google", level: "assessed" },
  // Tino's Slack app reads history for the knowledge base; outside the
  // Marketplace that is rate-limited into uselessness.
  slack: { provider: "slack", level: "assessed" },
};

/** Which client minted a credential. Stored next to every refresh token. */
export interface OAuthClientRef {
  owner: "org" | "platform";
  clientId: string;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** A client tino operates, as configured by the platform operator. */
export interface PlatformOAuthClient extends OAuthClientCredentials {
  approval: ApprovalLevel;
  /**
   * Serve capabilities above `approval` anyway, up to `userCap` people — e.g.
   * Google's unverified-app allowance. Off unless the operator opts in, and
   * the console warns the people it's offered to.
   */
  pilot?: { userCap: number };
  /** Org ids allowed to use it; absent means every org. */
  allowedOrgIds?: readonly string[];
}

/** What an org asked for in Settings. `auto` = own client if set, else managed. */
export type ClientPreference = "own" | "managed" | "auto";

export interface ResolveClientInput {
  capability: keyof typeof REQUIRED_APPROVAL;
  orgId: string;
  preference: ClientPreference;
  orgClient: OAuthClientCredentials | null;
  platformClient: PlatformOAuthClient | null;
  /** People already connected through the platform client (for the pilot cap). */
  platformClientUsers: number;
}

export type ClientResolution =
  | { ok: true; ref: OAuthClientRef; credentials: OAuthClientCredentials; pilot: boolean }
  | { ok: false; reason: "not_configured" | "not_approved" | "not_offered" | "cap_reached"; message: string };

/** Why the platform client can't serve this org, or null if it can. */
function platformProblem(input: ResolveClientInput): Exclude<ClientResolution, { ok: true }> | null {
  const { platformClient: pc, capability } = input;
  const need = REQUIRED_APPROVAL[capability]?.level ?? "assessed";
  if (!pc) {
    return { ok: false, reason: "not_offered", message: "tino doesn't offer a managed connection for this yet" };
  }
  if (pc.allowedOrgIds && !pc.allowedOrgIds.includes(input.orgId)) {
    return { ok: false, reason: "not_offered", message: "the managed connection isn't available for this org" };
  }
  if (covers(pc.approval, need)) return null;
  if (!pc.pilot) {
    return {
      ok: false,
      reason: "not_approved",
      message: "tino's managed connection isn't approved for this access yet — connect your own client",
    };
  }
  if (input.platformClientUsers >= pc.pilot.userCap) {
    return {
      ok: false,
      reason: "cap_reached",
      message: "the managed connection is full while it awaits approval — connect your own client",
    };
  }
  return null;
}

export function resolveOAuthClient(input: ResolveClientInput): ClientResolution {
  const { orgClient, platformClient, preference, capability } = input;
  const need = REQUIRED_APPROVAL[capability]?.level ?? "assessed";
  const managed = (): ClientResolution => {
    const problem = platformProblem(input);
    if (problem) return problem;
    const pc = platformClient as PlatformOAuthClient;
    return {
      ok: true,
      ref: { owner: "platform", clientId: pc.clientId },
      credentials: { clientId: pc.clientId, clientSecret: pc.clientSecret },
      pilot: !covers(pc.approval, need),
    };
  };
  const own = (): ClientResolution | null =>
    orgClient
      ? { ok: true, ref: { owner: "org", clientId: orgClient.clientId }, credentials: orgClient, pilot: false }
      : null;

  if (preference === "own") {
    return own() ?? { ok: false, reason: "not_configured", message: "add your OAuth client in Settings first" };
  }
  if (preference === "managed") {
    const m = managed();
    return m.ok ? m : (own() ?? m);
  }
  const viaOwn = own();
  if (viaOwn) return viaOwn;
  const m = managed();
  // Nothing managed on offer: the next step is the org's own client, so say that.
  return !m.ok && m.reason === "not_offered"
    ? { ok: false, reason: "not_configured", message: "add your own OAuth client in Settings to connect this" }
    : m;
}

/**
 * The client a stored credential must refresh against, or null when that
 * client is gone (rotated out, or the org switched) and the person has to
 * reconnect.
 */
export function clientForRef(
  ref: OAuthClientRef,
  orgClient: OAuthClientCredentials | null,
  platformClient: OAuthClientCredentials | null,
): OAuthClientCredentials | null {
  const candidate = ref.owner === "org" ? orgClient : platformClient;
  return candidate && candidate.clientId === ref.clientId ? candidate : null;
}
