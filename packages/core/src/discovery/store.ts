import type { ConfigStore } from "../persistence/config.js";
import type { DiscoveryResult } from "./types.js";

function configKey(userId: string): string {
  return `user.${userId}.discovery_result`;
}

export interface DiscoveryStore {
  get(userId: string): Promise<DiscoveryResult | null>;
  set(userId: string, result: DiscoveryResult): Promise<void>;
}

export function createDiscoveryStore(deps: {
  configStore: ConfigStore;
}): DiscoveryStore {
  const { configStore } = deps;

  return {
    async get(userId: string): Promise<DiscoveryResult | null> {
      const raw = await configStore.get(configKey(userId));
      if (!raw) return null;
      try { return JSON.parse(raw) as DiscoveryResult; }
      catch { return null; }
    },

    async set(userId: string, result: DiscoveryResult): Promise<void> {
      await configStore.set(configKey(userId), result);
    },
  };
}
