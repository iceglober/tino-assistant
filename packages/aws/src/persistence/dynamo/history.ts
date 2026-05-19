import type { HistoryStore } from "@tino/core/agent/history";
import { trim } from "@tino/core/agent/history";
import { HISTORY_SK, historyPk } from "@tino/core/persistence/keys";
import type { ModelMessage } from "ai";
import { DeleteItemCommand, GetItemCommand, PutItemCommand } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";
import { createHistoryEntity } from "./entities.js";

/**
 * DynamoDB-backed HistoryStore.
 *
 * Key pattern: pk=HISTORY#<userId>, sk=HISTORY
 * Stores messages as a JSON string in `messagesJson`.
 *
 * append() uses read-modify-write (GetItem + PutItem). This is safe for
 * single-user personal assistant use — no concurrent writers.
 */
export function createDynamoHistoryStore(table: TinoTable, cap = 40): HistoryStore {
  const entity = createHistoryEntity(table);

  return {
    async get(userId: string): Promise<ModelMessage[]> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: historyPk(userId), sk: HISTORY_SK })
        .send();

      if (!Item) return [];
      return JSON.parse(Item.messagesJson) as ModelMessage[];
    },

    async append(userId: string, msgs: ModelMessage[]): Promise<void> {
      const existing = await this.get(userId);
      const combined = [...existing, ...msgs];
      const trimmed = trim(combined, cap);

      await entity
        .build(PutItemCommand)
        .item({
          pk: historyPk(userId),
          sk: HISTORY_SK,
          messagesJson: JSON.stringify(trimmed),
          updatedAt: Date.now(),
        })
        .send();
    },

    async reset(userId: string): Promise<void> {
      await entity
        .build(DeleteItemCommand)
        .key({ pk: historyPk(userId), sk: HISTORY_SK })
        .send();
    },
  };
}
