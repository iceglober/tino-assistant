import type { Env } from '../../env.js';
import type { AppLogger } from '../../slack/app.js';
import type { HistoryStore } from '../../agent/history.js';
import type { TaskStore } from '../tasks.js';
import type { PreferencesStore } from '../preferences.js';
import type { ConfigStore } from '../config.js';
import { createDynamoTable } from './client.js';
import { createDynamoHistoryStore } from './history.js';
import { createDynamoTaskStore } from './tasks.js';
import { createDynamoPreferencesStore } from './preferences.js';
import { createDynamoConfigStore } from './config.js';

export interface DynamoPersistence {
  history: HistoryStore;
  tasks: TaskStore;
  preferences: PreferencesStore;
  config: ConfigStore;
}

export async function createDynamoPersistence(env: Env, logger: AppLogger): Promise<DynamoPersistence> {
  const tableName = env.DYNAMODB_TABLE_NAME;
  if (!tableName) {
    throw new Error('DYNAMODB_TABLE_NAME env var is required when PERSISTENCE_ADAPTER=dynamodb');
  }

  const endpoint = env.DYNAMODB_ENDPOINT;
  const table = await createDynamoTable(tableName, endpoint);

  logger.info(
    { adapter: 'dynamodb', tableName, endpoint: endpoint ?? '(aws default)', local: !!endpoint },
    'persistence initialized',
  );

  return {
    history: createDynamoHistoryStore(table),
    tasks: createDynamoTaskStore(table),
    preferences: createDynamoPreferencesStore(table),
    config: createDynamoConfigStore(table),
  };
}
