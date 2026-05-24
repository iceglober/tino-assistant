import type { AppLogger } from "../slack/app.js";
import type { AppDataClient } from "../drive/types.js";
import type { ConfigStore } from "../persistence/config.js";
import type { DiscoveryResult } from "./types.js";

const FILE_NAME = "discovery-result.json";

function configKey(userId: string): string {
  return `user.${userId}.discovery_result`;
}

export interface DiscoveryStore {
  get(userId: string): Promise<DiscoveryResult | null>;
  set(userId: string, result: DiscoveryResult): Promise<void>;
}

export function createDiscoveryStore(deps: {
  resolveClient: (userId: string) => Promise<AppDataClient | null>;
  configStore: ConfigStore;
  logger: AppLogger;
}): DiscoveryStore {
  const { resolveClient, configStore, logger } = deps;

  return {
    async get(userId: string): Promise<DiscoveryResult | null> {
      const client = await resolveClient(userId);
      if (client) {
        try {
          const result = await client.readJson<DiscoveryResult>(FILE_NAME);
          if (result) return result;
        } catch (err) {
          logger.info({ userId, err: (err as Error).message }, "appDataFolder: discovery result read failed, falling back");
        }
      }
      const raw = await configStore.get(configKey(userId));
      if (!raw) return null;
      try { return JSON.parse(raw) as DiscoveryResult; }
      catch { return null; }
    },

    async set(userId: string, result: DiscoveryResult): Promise<void> {
      const client = await resolveClient(userId);
      if (client) {
        try {
          await client.writeJson(FILE_NAME, result);
          return;
        } catch (err) {
          logger.info({ userId, err: (err as Error).message }, "appDataFolder: discovery result write failed, falling back");
        }
      }
      await configStore.set(configKey(userId), result);
    },
  };
}
