import type { GoogleCreds } from "../privacy/adapters/credentials.js";
import type { AppLogger } from "../slack/app.js";
import { createAppDataClient } from "./client-factory.js";
import { AppDataError, type AppDataClient } from "./types.js";

export function createAppDataClientResolver(deps: {
  resolveCreds: (userId: string) => Promise<GoogleCreds | null>;
  logger: AppLogger;
}): (userId: string) => Promise<AppDataClient | null> {
  const { resolveCreds, logger } = deps;
  const cache = new Map<string, AppDataClient>();
  const blocked = new Set<string>();

  return async (userId: string): Promise<AppDataClient | null> => {
    if (blocked.has(userId)) return null;
    if (cache.has(userId)) return cache.get(userId)!;

    const creds = await resolveCreds(userId);
    if (!creds) return null;

    const client = createAppDataClient(creds);

    // Probe with a lightweight list call to verify the scope is granted.
    try {
      await client.listFiles();
    } catch (err) {
      if (err instanceof AppDataError && err.code === "scope_missing") {
        logger.info({ userId }, "appDataFolder: user needs to re-authorize with drive.appdata scope");
        blocked.add(userId);
        return null;
      }
      if (err instanceof AppDataError && err.code === "auth_failed") {
        logger.info({ userId }, "appDataFolder: auth failed, falling back to server-side storage");
        return null;
      }
      logger.warn({ userId, err: (err as Error).message }, "appDataFolder: probe failed, falling back");
      return null;
    }

    cache.set(userId, client);
    return client;
  };
}
