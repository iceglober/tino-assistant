import type { HistoryStore } from "../agent/history.js";
import type { AuditLogger } from "../audit/logger.js";
import type { CryptoAdapter } from "../crypto/types.js";
import type { Env } from "../env.js";
import type { IdentityStore, UserStore } from "../identity/store.js";
import type { AppLogger } from "../slack/app.js";
import type { ConfigStore } from "./config.js";
import type { PreferencesStore } from "./preferences.js";
import type { TaskStore } from "./tasks.js";
import type { UserCapabilityStore } from "./user-capabilities.js";

export interface Persistence {
  history: HistoryStore;
  tasks: TaskStore;
  preferences: PreferencesStore;
  config: ConfigStore;
  /**
   * Per-user record store (wave 0). Backed by sqlite or dynamodb depending on
   * the adapter. Always present; the migration uses it on every startup.
   */
  users: UserStore;
  /**
   * External-identity link store (wave 0). Maps `(provider, externalId)`
   * pairs to tino-UUIDs. Always present.
   */
  identities: IdentityStore;
  /**
   * Per-user capability store (wave 2). Stores encrypted credentials and
   * settings per (userId, capabilityId). Backed by sqlite or dynamodb.
   * Always present.
   */
  userCapabilities: UserCapabilityStore;
  /**
   * Audit logger backing the HIPAA audit trail.
   *
   * - SQLite adapter: in-memory logger (entries lost on restart). Acceptable
   *   for local dev; production must use DynamoDB.
   * - DynamoDB adapter: durable logger writing to the same Tino table with
   *   TTL-based retention (default 90 days).
   *
   * Returning the audit logger from the factory keeps it co-located with the
   * adapter that owns the underlying table — avoids a second round of
   * `if (adapter === 'dynamodb')` branching at the entry point.
   */
  auditLogger: AuditLogger;
}

/**
 * Factory that creates the persistence layer based on the PERSISTENCE_ADAPTER env var.
 *
 * - 'sqlite' (default): uses bun:sqlite, reads DB_PATH (default './tino.db')
 * - 'dynamodb': uses DynamoDB Toolbox v2, reads DYNAMODB_TABLE_NAME (required)
 *
 * Dynamic imports keep the DynamoDB SDK out of the bundle when using SQLite.
 *
 * @param cryptoAdapter Optional CryptoAdapter for encrypting per-user credentials.
 *   Required if userCapabilities will be used. If omitted, userCapabilities
 *   will be created but fail at encrypt/decrypt time.
 */
export async function createPersistence(
  env: Env,
  logger: AppLogger,
  cryptoAdapter?: CryptoAdapter,
): Promise<Persistence> {
  const adapter = env.PERSISTENCE_ADAPTER ?? "sqlite";

  if (adapter === "dynamodb") {
    // Dynamic import keeps @tino/aws out of core's dependency tree
    // when using SQLite. The import only resolves if @tino/aws is installed.
    // @ts-expect-error — @tino/aws is an optional peer; not in core's dep tree
    const { createDynamoPersistence } = await import("@tino/aws/persistence");
    return createDynamoPersistence(env, logger, cryptoAdapter);
  }

  // Default: SQLite
  const dbPath = env.DB_PATH ?? "./tino.db";
  const { createSqliteHistoryStore } = await import("./sqlite.js");
  const { createTaskStore } = await import("./tasks.js");
  const { createPreferencesStore } = await import("./preferences.js");
  const { createConfigStore } = await import("./config.js");
  const { createMemoryAuditLogger } = await import("../audit/memory.js");
  const { createSqliteUserStore, createSqliteIdentityStore } = await import("../identity/store.js");
  const { createSqliteUserCapabilityStore } = await import("./user-capabilities.js");

  const history = createSqliteHistoryStore({ dbPath, cap: 40 });
  const tasks = createTaskStore({ dbPath });
  const preferences = createPreferencesStore({ dbPath });
  const config = createConfigStore({ dbPath });
  const users = createSqliteUserStore({ dbPath });
  const identities = createSqliteIdentityStore({ dbPath });

  if (!cryptoAdapter) {
    throw new Error("CryptoAdapter is required for SQLite persistence layer");
  }

  const userCapabilities = createSqliteUserCapabilityStore({ dbPath, cryptoAdapter });
  const auditLogger = createMemoryAuditLogger();

  logger.info({ adapter: "sqlite", dbPath }, "persistence initialized");
  return { history, tasks, preferences, config, users, identities, userCapabilities, auditLogger };
}
