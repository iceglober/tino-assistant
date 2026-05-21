import type { PreferencesStore } from "../../persistence/preferences.js";
import type { AppLogger } from "../../slack/app.js";
import type { AppDataClient } from "../types.js";

const FILE_NAME = "preferences.json";

export function createAppDataPreferencesStore(deps: {
  resolveClient: (userId: string) => Promise<AppDataClient | null>;
  fallback: PreferencesStore;
  logger: AppLogger;
}): PreferencesStore {
  const { resolveClient, fallback, logger } = deps;

  async function readAll(client: AppDataClient): Promise<Record<string, string> | null> {
    try {
      return await client.readJson<Record<string, string>>(FILE_NAME);
    } catch {
      return null;
    }
  }

  return {
    async get(userId: string, key: string): Promise<string | null> {
      const client = await resolveClient(userId);
      if (client) {
        const prefs = await readAll(client);
        if (prefs) return prefs[key] ?? null;
      }
      return fallback.get(userId, key);
    },

    async set(userId: string, key: string, value: string): Promise<void> {
      const client = await resolveClient(userId);
      if (client) {
        try {
          const prefs = (await readAll(client)) ?? {};
          prefs[key] = value;
          await client.writeJson(FILE_NAME, prefs);
          return;
        } catch (err) {
          logger.info({ userId, err: (err as Error).message }, "appDataFolder: preferences write failed, falling back");
        }
      }
      await fallback.set(userId, key, value);
    },

    async list(userId: string): Promise<Array<{ key: string; value: string }>> {
      const client = await resolveClient(userId);
      if (client) {
        const prefs = await readAll(client);
        if (prefs) {
          return Object.entries(prefs).map(([key, value]) => ({ key, value }));
        }
      }
      return fallback.list(userId);
    },

    async delete(userId: string, key: string): Promise<void> {
      const client = await resolveClient(userId);
      if (client) {
        try {
          const prefs = (await readAll(client)) ?? {};
          delete prefs[key];
          await client.writeJson(FILE_NAME, prefs);
          return;
        } catch (err) {
          logger.info({ userId, err: (err as Error).message }, "appDataFolder: preferences delete failed, falling back");
        }
      }
      await fallback.delete(userId, key);
    },
  };
}
