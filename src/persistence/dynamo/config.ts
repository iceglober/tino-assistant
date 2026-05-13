import {
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from 'dynamodb-toolbox';
import type { ConfigStore } from '../../persistence/config.js';
import { createConfigEntity } from './entities.js';
import type { TinoTable } from './client.js';

/**
 * DynamoDB-backed ConfigStore.
 *
 * Key pattern: pk=CONFIG, sk=CONFIG#<key>
 * list() uses a Query on pk=CONFIG with sk begins_with CONFIG#
 */
export function createDynamoConfigStore(table: TinoTable): ConfigStore {
  const entity = createConfigEntity(table);

  return {
    async get(key: string): Promise<string | null> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: 'CONFIG', sk: `CONFIG#${key}` })
        .send();

      return Item?.value ?? null;
    },

    async getTyped<T>(key: string, fallback: T): Promise<T> {
      const raw = await this.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      await entity
        .build(PutItemCommand)
        .item({
          pk: 'CONFIG',
          sk: `CONFIG#${key}`,
          value: JSON.stringify(value),
          updatedAt: Date.now(),
        })
        .send();
    },

    async list(): Promise<Array<{ key: string; value: string; updatedAt: number }>> {
      const { Items = [] } = await table
        .build(QueryCommand)
        .entities(entity)
        .query({
          partition: 'CONFIG',
          range: { beginsWith: 'CONFIG#' },
        })
        .send();

      return (Items as Array<{ sk: string; value: string; updatedAt: number }>)
        .map(item => ({
          key: item.sk.replace(/^CONFIG#/, ''),
          value: item.value,
          updatedAt: item.updatedAt,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },

    async delete(key: string): Promise<boolean> {
      // DynamoDB DeleteItem doesn't return whether the item existed by default.
      // We check existence first, then delete.
      const existing = await this.get(key);
      if (!existing) return false;

      await entity
        .build(DeleteItemCommand)
        .key({ pk: 'CONFIG', sk: `CONFIG#${key}` })
        .send();

      return true;
    },
  };
}
