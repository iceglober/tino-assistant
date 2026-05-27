import crypto from "node:crypto";
import type { Task, TaskStore } from "@tino/core/persistence/tasks";
import { GetItemCommand, PutItemCommand, QueryCommand, ScanCommand, UpdateItemCommand } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";
import { createTaskEntity, padScheduledAt } from "./entities.js";

/**
 * DynamoDB-backed TaskStore.
 *
 * Key pattern: pk=TASK#<taskId>, sk=TASK
 * GSI1: gsi1pk=TASK_STATUS#<status>, gsi1sk=<scheduledAt zero-padded 13 digits>
 *
 * listPending uses GSI1 query: gsi1pk=TASK_STATUS#pending AND gsi1sk <= <now>
 * listByUser uses a Scan with filter (rare operation, fine for <100 tasks)
 * cancel uses a conditional UpdateItem (only if status=pending)
 */
export function createDynamoTaskStore(table: TinoTable): TaskStore {
  const entity = createTaskEntity(table);

  return {
    async create(userId: string, description: string, scheduledAtEpochSec: number, recurring?: { intervalSec: number; expiresAt: number }): Promise<Task> {
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      await entity
        .build(PutItemCommand)
        .item({
          pk: `TASK#${id}`,
          sk: "TASK",
          gsi1pk: "TASK_STATUS#pending",
          gsi1sk: padScheduledAt(scheduledAtEpochSec),
          taskId: id,
          userId,
          description,
          scheduledAt: scheduledAtEpochSec,
          status: "pending",
          createdAt: now,
          updatedAt: now,
          ...(recurring ? { intervalSec: recurring.intervalSec, expiresAt: recurring.expiresAt } : {}),
        })
        .send();

      return {
        id,
        userId,
        description,
        scheduledAt: scheduledAtEpochSec,
        status: "pending",
        result: null,
        createdAt: now,
        updatedAt: now,
        intervalSec: recurring?.intervalSec ?? null,
        expiresAt: recurring?.expiresAt ?? null,
      };
    },

    async getById(id: string): Promise<Task | null> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: `TASK#${id}`, sk: "TASK" })
        .send();

      if (!Item) return null;
      return itemToTask(Item);
    },

    async listByUser(userId: string, status?: string): Promise<Task[]> {
      // Scan with filter — rare operation, fine for <100 tasks
      const { Items = [] } = await table
        .build(ScanCommand)
        .entities(entity)
        .options({
          filters: {
            Task:
              status !== undefined
                ? {
                    and: [
                      { attr: "userId", eq: userId },
                      { attr: "status", eq: status },
                    ],
                  }
                : { attr: "userId", eq: userId },
          },
        })
        .send();

      return (Items as unknown as TaskItem[]).map(itemToTask).sort((a, b) => a.scheduledAt - b.scheduledAt);
    },

    async listPending(nowEpochSec: number): Promise<Task[]> {
      const { Items = [] } = await table
        .build(QueryCommand)
        .entities(entity)
        .query({
          index: "gsi1",
          partition: "TASK_STATUS#pending",
          range: { lte: padScheduledAt(nowEpochSec) },
        })
        .send();

      return (Items as unknown as TaskItem[]).map(itemToTask).sort((a, b) => a.scheduledAt - b.scheduledAt);
    },

    async updateStatus(id: string, status: Task["status"], result?: string): Promise<void> {
      const now = Math.floor(Date.now() / 1000);

      const cmd = entity.build(UpdateItemCommand).item({
        pk: `TASK#${id}`,
        sk: "TASK",
        status,
        gsi1pk: `TASK_STATUS#${status}`,
        updatedAt: now,
        ...(result !== undefined ? { result } : {}),
      });

      await cmd.send();
    },

    async cancel(id: string): Promise<boolean> {
      const now = Math.floor(Date.now() / 1000);

      try {
        await entity
          .build(UpdateItemCommand)
          .item({
            pk: `TASK#${id}`,
            sk: "TASK",
            status: "cancelled",
            gsi1pk: "TASK_STATUS#cancelled",
            updatedAt: now,
          })
          .options({
            condition: { attr: "status", eq: "pending" },
          })
          .send();
        return true;
      } catch (err) {
        // ConditionalCheckFailedException means task not found or not pending
        if (isConditionalCheckFailed(err)) return false;
        throw err;
      }
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TaskItem {
  taskId: string;
  userId: string;
  description: string;
  scheduledAt: number;
  status: string;
  result?: string;
  createdAt: number;
  updatedAt: number;
  intervalSec?: number;
  expiresAt?: number;
}

function itemToTask(item: TaskItem): Task {
  return {
    id: item.taskId,
    userId: item.userId,
    description: item.description,
    scheduledAt: item.scheduledAt,
    status: item.status as Task["status"],
    result: item.result ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    intervalSec: item.intervalSec ?? null,
    expiresAt: item.expiresAt ?? null,
  };
}

function isConditionalCheckFailed(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === "ConditionalCheckFailedException" || err.message.includes("ConditionalCheckFailed");
  }
  return false;
}
