import type { Env } from '../env.js';
import type { AppLogger } from '../slack/app.js';
import type { HistoryStore } from '../agent/history.js';
import type { TaskStore } from './tasks.js';
import type { PreferencesStore } from './preferences.js';
import type { ConfigStore } from './config.js';

export interface Persistence {
  history: HistoryStore;
  tasks: TaskStore;
  preferences: PreferencesStore;
  config: ConfigStore;
}

/**
 * Factory that creates the persistence layer based on the PERSISTENCE_ADAPTER env var.
 *
 * - 'sqlite' (default): uses better-sqlite3, reads DB_PATH (default './tino.db')
 * - 'dynamodb': uses DynamoDB Toolbox v2, reads DYNAMODB_TABLE_NAME (required)
 *
 * Dynamic imports keep the DynamoDB SDK out of the bundle when using SQLite.
 */
export async function createPersistence(env: Env, logger: AppLogger): Promise<Persistence> {
  const adapter = env.PERSISTENCE_ADAPTER ?? 'sqlite';

  if (adapter === 'dynamodb') {
    const { createDynamoPersistence } = await import('./dynamo/index.js');
    return createDynamoPersistence(env, logger);
  }

  // Default: SQLite
  const dbPath = env.DB_PATH ?? './tino.db';
  const { createSqliteHistoryStore } = await import('./sqlite.js');
  const { createTaskStore } = await import('./tasks.js');
  const { createPreferencesStore } = await import('./preferences.js');
  const { createConfigStore } = await import('./config.js');

  const history = createSqliteHistoryStore({ dbPath, cap: 40 });
  const tasks = createTaskStore({ dbPath });
  const preferences = createPreferencesStore({ dbPath });
  const config = createConfigStore({ dbPath });

  logger.info({ adapter: 'sqlite', dbPath }, 'persistence initialized');
  return { history, tasks, preferences, config };
}
