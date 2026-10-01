import type { Env } from "../../../env.js";
import type {
  ConfigStore,
  CryptoAdapter,
  ConversationLog,
  IdentityStore,
  Logger,
  UserCapabilityStore,
  UserStore,
} from "@tino/core/ports/outbound";

export interface Persistence {
  /** Every conversation, one labelled row per message. */
  conversations: ConversationLog;
  /** Config KV — Slack/model/Google keys + per-user creds fallback. */
  config: ConfigStore;
  /** Per-user record store. */
  users: UserStore;
  /** External-identity link store: (provider, externalId) → tino-UUID. */
  identities: IdentityStore;
  /** Encrypted per-user credential store (Google OAuth, Slack user tokens). */
  userCapabilities: UserCapabilityStore;
  /**
   * DB handle for better-auth's `database` option: a pg Pool (postgres) or a
   * bun:sqlite Database (local dev). better-auth manages its own tables on it.
   */
  authDatabase?: unknown;
  /** Read better-auth's stored Google refresh token (SSO credential sync). */
  getGoogleRefreshToken?: (betterAuthUserId: string) => Promise<string | null>;
  /** The shared pg Pool (postgres only) — used by the KB subsystem. */
  pgPool?: import("pg").Pool;
}

/**
 * Create the persistence layer based on PERSISTENCE_ADAPTER.
 * - 'sqlite' (default): bun:sqlite at DB_PATH (default './tino.db') — local dev.
 * - 'postgres': Cloud SQL / any Postgres via DATABASE_URL (production).
 */
export async function createPersistence(
  env: Env,
  logger: Logger,
  cryptoAdapter?: CryptoAdapter,
): Promise<Persistence> {
  const adapter = env.PERSISTENCE_ADAPTER ?? "sqlite";

  if (adapter === "postgres") {
    // Dynamic import keeps `pg` off the sqlite dev path.
    const { createPgPersistence } = await import("./postgres/index.js");
    return createPgPersistence(env, logger, cryptoAdapter);
  }

  const dbPath = env.DB_PATH ?? "./tino.db";
  const { createSqliteConversationLog } = await import("./sqlite-conversation-log.js");
  const { createConfigStore } = await import("./config.js");
  const { createSqliteUserStore, createSqliteIdentityStore } = await import("../identity/store.js");
  const { createSqliteUserCapabilityStore } = await import("./user-capabilities.js");
  const { Database } = await import("bun:sqlite");

  if (!cryptoAdapter) {
    throw new Error("CryptoAdapter is required for SQLite persistence layer");
  }

  const conversations = createSqliteConversationLog({ dbPath, logger });
  const config = createConfigStore({ dbPath });
  const users = createSqliteUserStore({ dbPath });
  const identities = createSqliteIdentityStore({ dbPath });
  const userCapabilities = createSqliteUserCapabilityStore({ dbPath, cryptoAdapter });

  // better-auth's DB lives in a separate sqlite file (its own table set).
  const authDbPath = env.AUTH_DB_PATH ?? process.env.AUTH_DB_PATH ?? "/tmp/tino-auth.db";
  const authDatabase = new Database(authDbPath);

  const getGoogleRefreshToken = async (betterAuthUserId: string): Promise<string | null> => {
    try {
      const db = new Database(authDbPath, { readonly: true });
      const row = db
        .query<{ refreshToken: string | null }, [string]>(
          "SELECT refreshToken FROM account WHERE userId = ? AND providerId = 'google' LIMIT 1",
        )
        .get(betterAuthUserId);
      db.close();
      return row?.refreshToken ?? null;
    } catch {
      return null;
    }
  };

  logger.info({ adapter: "sqlite", dbPath, authDbPath }, "persistence initialized");
  return { conversations, config, users, identities, userCapabilities, authDatabase, getGoogleRefreshToken };
}
