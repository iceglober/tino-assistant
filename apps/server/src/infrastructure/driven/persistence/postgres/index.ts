/**
 * Postgres persistence assembly: one pg Pool, ensure-DDL (+ the one-time move
 * of old history into the conversation log), the five stores, plus
 * the auth-DB handle better-auth uses directly (the same pool) and the raw
 * account-table read for Google credential sync.
 */
import type { Env } from "../../../../env.js";
import type { CryptoAdapter, Logger } from "@tino/core/ports/outbound";
import type { Persistence } from "../factory.js";
import { getGoogleRefreshTokenPg } from "./auth-account.js";
import { createPgPool } from "./client.js";
import { createPgConfigStore } from "./config.js";
import { createPgConversationLog, importOldHistoryOnce } from "./conversation-log.js";
import { ensureSchema } from "./schema.js";
import { createPgUserCapabilityStore } from "./user-capabilities.js";
import { createPgIdentityStore, createPgUserStore } from "./users.js";

export async function createPgPersistence(env: Env, logger: Logger, cryptoAdapter?: CryptoAdapter): Promise<Persistence> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when PERSISTENCE_ADAPTER=postgres");
  }
  if (!cryptoAdapter) {
    throw new Error("CryptoAdapter is required for the Postgres persistence layer");
  }

  const pool = createPgPool(env.DATABASE_URL);
  await ensureSchema(pool, logger);
  await importOldHistoryOnce(pool, logger);

  logger.info({ adapter: "postgres" }, "persistence initialized");
  return {
    conversations: createPgConversationLog({ pool }),
    config: createPgConfigStore({ pool }),
    users: createPgUserStore({ pool }),
    identities: createPgIdentityStore({ pool }),
    userCapabilities: createPgUserCapabilityStore({ pool, cryptoAdapter }),
    authDatabase: pool,
    getGoogleRefreshToken: (betterAuthUserId) => getGoogleRefreshTokenPg(pool, betterAuthUserId),
    pgPool: pool,
  };
}
