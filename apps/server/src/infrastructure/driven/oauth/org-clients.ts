/**
 * Applies the client policy (domain/oauth-clients.ts) to one org's settings
 * and the platform's clients, and keeps client secrets out of per-person
 * records.
 *
 * A person's Google credential stores only the refresh token plus a reference
 * to the client that minted it (`settings.client`). The secret is joined in on
 * read from the org's settings or the platform env — so rotating a client
 * secret is one edit in Settings, not a re-consent for every member — and a
 * credential whose client is gone reads as "not connected" rather than failing
 * at refresh time.
 */
import {
  type ClientPreference,
  type ClientResolution,
  clientForRef,
  type OAuthClientCredentials,
  type OAuthClientRef,
  type PlatformOAuthClient,
  REQUIRED_APPROVAL,
  resolveOAuthClient,
} from "@tino/core/domain/oauth-clients";
import type { CapabilityConfig } from "@tino/core/domain/types";
import type { ConfigStore, UserCapabilityStore } from "@tino/core/ports/outbound";

export type ClientCapability = keyof typeof REQUIRED_APPROVAL;

export interface OrgOAuthClients {
  /** Which client a new connection for `capability` would use, or why there is none. */
  resolve(capability: ClientCapability): Promise<ClientResolution>;
  /** The live credentials for a stored reference, or null if that client is gone. */
  forRef(provider: "google" | "slack", ref: OAuthClientRef): Promise<OAuthClientCredentials | null>;
  /** The org's own client for a provider, if configured. */
  own(provider: "google" | "slack"): Promise<OAuthClientCredentials | null>;
}

const KEYS = {
  google: { id: "google.oauth.clientId", secret: "google.oauth.clientSecret", mode: "google.oauth.mode" },
  slack: { id: "slack.clientId", secret: "slack.clientSecret", mode: "slack.mode" },
} as const;

export function createOrgOAuthClients(opts: {
  orgId: string;
  config: ConfigStore;
  platform: { google: PlatformOAuthClient | null; slack: PlatformOAuthClient | null };
  /** People connected through the platform client for a capability, across all orgs (pilot cap). */
  platformUsers: (capability: ClientCapability) => Promise<number>;
}): OrgOAuthClients {
  const { orgId, config, platform } = opts;

  const own = async (provider: "google" | "slack"): Promise<OAuthClientCredentials | null> => {
    const clientId = await config.getTyped<string>(KEYS[provider].id, "");
    const clientSecret = await config.getTyped<string>(KEYS[provider].secret, "");
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  };

  return {
    own,

    async resolve(capability) {
      const provider = REQUIRED_APPROVAL[capability]?.provider ?? "google";
      const preference = await config.getTyped<ClientPreference>(KEYS[provider].mode, "auto");
      const platformClient = platform[provider];
      return resolveOAuthClient({
        capability,
        orgId,
        preference,
        orgClient: await own(provider),
        platformClient,
        platformClientUsers: platformClient?.pilot ? await opts.platformUsers(capability) : 0,
      });
    },

    async forRef(provider, ref) {
      return clientForRef(ref, await own(provider), platform[provider]);
    },
  };
}

const GOOGLE_CAPABILITIES = new Set(["gmail", "calendar"]);

/** Read a stored client reference out of a capability's settings. */
export function clientRefOf(cfg: CapabilityConfig | null): OAuthClientRef | null {
  const raw = cfg?.settings?.client as Partial<OAuthClientRef> | undefined;
  return raw && (raw.owner === "org" || raw.owner === "platform") && typeof raw.clientId === "string"
    ? { owner: raw.owner, clientId: raw.clientId }
    : null;
}

/**
 * A UserCapabilityStore whose Google credentials come back with the issuing
 * client's id and secret joined in — the shape the Gmail/Calendar tools and the
 * Gmail source expect — or without them when that client no longer exists.
 */
export function withGoogleClientSecrets(caps: UserCapabilityStore, clients: OrgOAuthClients): UserCapabilityStore {
  return {
    ...caps,
    async get(userId, capabilityId) {
      const cfg = await caps.get(userId, capabilityId);
      if (!cfg || !GOOGLE_CAPABILITIES.has(capabilityId)) return cfg;
      const ref = clientRefOf(cfg);
      const client = ref ? await clients.forRef("google", ref) : null;
      const { clientId: _id, clientSecret: _secret, ...rest } = cfg.credentials;
      return client
        ? { ...cfg, credentials: { ...rest, clientId: client.clientId, clientSecret: client.clientSecret } }
        : { ...cfg, credentials: rest };
    },
  };
}
