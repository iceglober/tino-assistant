import type { Env } from '@tino/core/env';
import type { AppLogger } from '@tino/core/slack/app';
import type { HistoryStore } from '@tino/core/agent/history';
import type { TaskStore } from '@tino/core/persistence/tasks';
import type { PreferencesStore } from '@tino/core/persistence/preferences';
import type { ConfigStore } from '@tino/core/persistence/config';
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
