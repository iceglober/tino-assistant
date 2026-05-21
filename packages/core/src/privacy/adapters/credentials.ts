import type { CapabilityConfig } from "../../capabilities/types.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { UserCapabilityStore } from "../../persistence/user-capabilities.js";

export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface SlackCreds {
  userToken: string;
}

export function createGoogleCredentialResolver(deps: {
  userCapabilities?: UserCapabilityStore;
  configStore?: ConfigStore;
}): (userId: string) => Promise<GoogleCreds | null> {
  const { userCapabilities, configStore } = deps;

  return async (userId: string): Promise<GoogleCreds | null> => {
    let config: CapabilityConfig | null = null;

    if (userCapabilities) {
      config = await userCapabilities.get(userId, "gmail");
    }
    if (!config && configStore) {
      const raw = await configStore.get(`user.${userId}.capability.gmail`);
      if (raw) {
        try {
          config = JSON.parse(raw) as CapabilityConfig;
        } catch {
          return null;
        }
      }
    }
    if (!config) return null;

    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId || !clientSecret || !refreshToken) return null;
    return { clientId, clientSecret, refreshToken };
  };
}

export function createSlackCredentialResolver(deps: {
  userCapabilities?: UserCapabilityStore;
  configStore?: ConfigStore;
}): (userId: string) => Promise<SlackCreds | null> {
  const { userCapabilities, configStore } = deps;

  return async (userId: string): Promise<SlackCreds | null> => {
    let config: CapabilityConfig | null = null;

    if (userCapabilities) {
      config = await userCapabilities.get(userId, "slack-personal");
    }
    if (!config && configStore) {
      const raw = await configStore.get(`user.${userId}.capability.slack-personal`);
      if (raw) {
        try {
          config = JSON.parse(raw) as CapabilityConfig;
        } catch {
          return null;
        }
      }
    }
    if (!config?.credentials?.userToken) return null;
    return { userToken: config.credentials.userToken };
  };
}
