import type { Env } from '../env.js';
import type { AppLogger } from '../slack/app.js';
import type { HistoryStore } from '../agent/history.js';
import type { TaskStore } from './tasks.js';
import type { PreferencesStore } from './preferences.js';
import type { ConfigStore } from './config.js';
import type { AuditLogger } from '../audit/logger.js';

export interface Persistence {
  history: HistoryStore;
  tasks: TaskStore;
  preferences: PreferencesStore;
  config: ConfigStore;
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
 */
export async function createPersistence(env: Env, logger: AppLogger): Promise<Persistence> {
  const adapter = env.PERSISTENCE_ADAPTER ?? 'sqlite';

  if (adapter === 'dynamodb') {
    // Dynamic import keeps @tino/aws out of core's dependency tree
    // when using SQLite. The import only resolves if @tino/aws is installed.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — @tino/aws is an optional peer; not in core's dep tree
    const { createDynamoPersistence } = await import('@tino/aws/persistence');
    return createDynamoPersistence(env, logger);
  }

  // Default: SQLite
  const dbPath = env.DB_PATH ?? './tino.db';
  const { createSqliteHistoryStore } = await import('./sqlite.js');
  const { createTaskStore } = await import('./tasks.js');
  const { createPreferencesStore } = await import('./preferences.js');
  const { createConfigStore } = await import('./config.js');
  const { createMemoryAuditLogger } = await import('../audit/memory.js');

  const history = createSqliteHistoryStore({ dbPath, cap: 40 });
  const tasks = createTaskStore({ dbPath });
  const preferences = createPreferencesStore({ dbPath });
  const config = createConfigStore({ dbPath });
  const auditLogger = createMemoryAuditLogger();

  logger.info({ adapter: 'sqlite', dbPath }, 'persistence initialized');
  return { history, tasks, preferences, config, auditLogger };
}
