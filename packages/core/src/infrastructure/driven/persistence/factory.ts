import type { Env } from "../../../env.js";
import type {
  ConfigStore,
  CryptoAdapter,
  HistoryStore,
  IdentityStore,
  Logger,
  SessionSecondaryStorage,
  UserCapabilityStore,
  UserStore,
} from "../../../ports/outbound.js";

export interface Persistence {
  /** Conversation history (in-memory, cap 40). */
  history: HistoryStore;
  /** Config KV — Slack/Azure/Google keys + per-user Google creds fallback. */
  config: ConfigStore;
  /** Per-user record store. */
  users: UserStore;
  /** External-identity link store: (provider, externalId) → tino-UUID. */
  identities: IdentityStore;
  /** Encrypted per-user credential store (Google OAuth). */
  userCapabilities: UserCapabilityStore;
  /** better-auth secondaryStorage (dynamodb only; undefined on sqlite). */
  sessionStore?: SessionSecondaryStorage;
}

/**
 * Create the persistence layer based on PERSISTENCE_ADAPTER.
 * - 'sqlite' (default): bun:sqlite at DB_PATH (default './tino.db').
 * - 'dynamodb': DynamoDB via @tino/aws.
 */
export async function createPersistence(
  env: Env,
  logger: Logger,
  cryptoAdapter?: CryptoAdapter,
): Promise<Persistence> {
  const adapter = env.PERSISTENCE_ADAPTER ?? "sqlite";

  if (adapter === "dynamodb") {
    // @ts-expect-error — @tino/aws is an optional peer; not in core's dep tree
    const { createDynamoPersistence } = await import("@tino/aws/persistence");
    return createDynamoPersistence(env, logger, cryptoAdapter);
  }

  const dbPath = env.DB_PATH ?? "./tino.db";
  const { createSqliteHistoryStore } = await import("./sqlite-history.js");
  const { createConfigStore } = await import("./config.js");
  const { createSqliteUserStore, createSqliteIdentityStore } = await import("../identity/store.js");
  const { createSqliteUserCapabilityStore } = await import("./user-capabilities.js");

  if (!cryptoAdapter) {
    throw new Error("CryptoAdapter is required for SQLite persistence layer");
  }

  const history = createSqliteHistoryStore({ dbPath, cap: 40 });
  const config = createConfigStore({ dbPath });
  const users = createSqliteUserStore({ dbPath });
  const identities = createSqliteIdentityStore({ dbPath });
  const userCapabilities = createSqliteUserCapabilityStore({ dbPath, cryptoAdapter });

  logger.info({ adapter: "sqlite", dbPath }, "persistence initialized");
  return { history, config, users, identities, userCapabilities };
}
