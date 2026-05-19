import { DeleteItemCommand, GetItemCommand, PutItemCommand } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";
import { createSessionEntity } from "./entities.js";

/**
 * better-auth SecondaryStorage adapter backed by DynamoDB.
 *
 * Key pattern: pk=SESSION#<key>, sk=SESSION#<key>
 * TTL: `expiresAt` (epoch seconds) — DynamoDB's native TTL evicts expired items.
 *
 * The interface matches better-auth's SecondaryStorage:
 *   get(key) → string | null
 *   set(key, value, ttl?) → void
 *   delete(key) → void
 */
export interface SessionSecondaryStorage {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttl?: number) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export function createDynamoSessionStore(table: TinoTable): SessionSecondaryStorage {
  const entity = createSessionEntity(table);

  return {
    async get(key: string): Promise<string | null> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: `SESSION#${key}`, sk: `SESSION#${key}` })
        .send();

      if (!Item) return null;

      if (Item.expiresAt && Item.expiresAt < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return Item.value ?? null;
    },

    async set(key: string, value: string, ttl?: number): Promise<void> {
      const item = {
        pk: `SESSION#${key}`,
        sk: `SESSION#${key}`,
        value,
        updatedAt: Date.now(),
        ...(ttl !== undefined && ttl > 0
          ? { expiresAt: Math.floor(Date.now() / 1000) + ttl }
          : {}),
      };

      await entity.build(PutItemCommand).item(item).send();
    },

    async delete(key: string): Promise<void> {
      await entity
        .build(DeleteItemCommand)
        .key({ pk: `SESSION#${key}`, sk: `SESSION#${key}` })
        .send();
    },
  };
}
