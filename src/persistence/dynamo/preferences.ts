import {
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from 'dynamodb-toolbox';
import type { PreferencesStore } from '../../persistence/preferences.js';
import { createPreferenceEntity } from './entities.js';
import type { TinoTable } from './client.js';

/**
 * DynamoDB-backed PreferencesStore.
 *
 * Key pattern: pk=PREF#<userId>, sk=PREF#<key>
 * list() uses a Query on pk=PREF#<userId> with sk begins_with PREF#
 */
export function createDynamoPreferencesStore(table: TinoTable): PreferencesStore {
  const entity = createPreferenceEntity(table);

  return {
    async get(userId: string, key: string): Promise<string | null> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: `PREF#${userId}`, sk: `PREF#${key}` })
        .send();

      return Item?.value ?? null;
    },

    async set(userId: string, key: string, value: string): Promise<void> {
      await entity
        .build(PutItemCommand)
        .item({
          pk: `PREF#${userId}`,
          sk: `PREF#${key}`,
          value,
          updatedAt: Date.now(),
        })
        .send();
    },

    async list(userId: string): Promise<Array<{ key: string; value: string }>> {
      const { Items = [] } = await table
        .build(QueryCommand)
        .entities(entity)
        .query({
          partition: `PREF#${userId}`,
          range: { beginsWith: 'PREF#' },
        })
        .send();

      return (Items as Array<{ sk: string; value: string }>)
        .map(item => ({
          key: item.sk.replace(/^PREF#/, ''),
          value: item.value,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },

    async delete(userId: string, key: string): Promise<void> {
      await entity
        .build(DeleteItemCommand)
        .key({ pk: `PREF#${userId}`, sk: `PREF#${key}` })
        .send();
    },
  };
}
