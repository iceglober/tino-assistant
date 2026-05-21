import type { PrivacyConfigStore } from "../../privacy/config-store.js";
import { computeDelta, isAdditive } from "../../privacy/config-utils.js";
import type { PrivacyConfig } from "../../privacy/types.js";
import type { AppLogger } from "../../slack/app.js";
import type { AppDataClient } from "../types.js";

const FILE_NAME = "privacy-config.json";

export function createAppDataPrivacyConfigStore(deps: {
  resolveClient: (userId: string) => Promise<AppDataClient | null>;
  fallback: PrivacyConfigStore;
  logger: AppLogger;
}): PrivacyConfigStore {
  const { resolveClient, fallback, logger } = deps;

  return {
    async get(tinoUserId: string): Promise<PrivacyConfig | null> {
      const client = await resolveClient(tinoUserId);
      if (client) {
        try {
          const config = await client.readJson<PrivacyConfig>(FILE_NAME);
          if (config) return config;
        } catch (err) {
          logger.info({ userId: tinoUserId, err: (err as Error).message }, "appDataFolder: privacy config read failed, falling back");
        }
      }
      return fallback.get(tinoUserId);
    },

    async set(tinoUserId: string, config: PrivacyConfig): Promise<void> {
      const client = await resolveClient(tinoUserId);
      if (client) {
        try {
          await client.writeJson(FILE_NAME, config);
          return;
        } catch (err) {
          logger.info({ userId: tinoUserId, err: (err as Error).message }, "appDataFolder: privacy config write failed, falling back");
        }
      }
      await fallback.set(tinoUserId, config);
    },

    computeDelta,
    isAdditive,
  };
}
