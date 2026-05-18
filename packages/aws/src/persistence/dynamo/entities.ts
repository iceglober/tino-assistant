import { Entity, item, number, string } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";

/**
 * DynamoDB Toolbox v2 entity definitions for all stores.
 *
 * Key patterns:
 *   History:    pk=HISTORY#<userId>             sk=HISTORY
 *   Task:       pk=TASK#<taskId>                sk=TASK
 *   Preference: pk=PREF#<userId>                sk=PREF#<key>
 *   Config:     pk=CONFIG                       sk=CONFIG#<key>
 *   User:       pk=ORG#USER#<tinoUserId>        sk=ORG#USER#<tinoUserId>
 *   Identity:   pk=IDENTITY#<provider>#<externalId>  sk=same
 *
 * GSI1 (tasks only):
 *   gsi1pk=TASK_STATUS#<status>  gsi1sk=<scheduledAt zero-padded 13 digits>
 *
 * The User and Identity entities use single-row partitions (sk == pk) to keep
 * a stable shape for a future tenant-prefix migration; key prefixes are
 * already namespaced under `ORG#` / `IDENTITY#` so adding `TENANT#<id>#` at
 * the front is an additive change.
 */

// ── History ──────────────────────────────────────────────────────────────────

export function createHistoryEntity(table: TinoTable) {
  return new Entity({
    name: "History",
    table,
    schema: item({
      pk: string().key(),
      sk: string().key(),
      messagesJson: string(),
      updatedAt: number(),
    }),
    timestamps: false,
  });
}

// ── Task ─────────────────────────────────────────────────────────────────────

export function createTaskEntity(table: TinoTable) {
  return new Entity({
    name: "Task",
    table,
    schema: item({
      pk: string().key(),
      sk: string().key(),
      gsi1pk: string(),
      gsi1sk: string(),
      taskId: string(),
      userId: string(),
      description: string(),
      scheduledAt: number(),
      status: string(),
      result: string().optional(),
      createdAt: number(),
      updatedAt: number(),
    }),
    timestamps: false,
  });
}

// ── Preference ───────────────────────────────────────────────────────────────

export function createPreferenceEntity(table: TinoTable) {
  return new Entity({
    name: "Preference",
    table,
    schema: item({
      pk: string().key(),
      sk: string().key(),
      value: string(),
      updatedAt: number(),
    }),
    timestamps: false,
  });
}

// ── Config ───────────────────────────────────────────────────────────────────

export function createConfigEntity(table: TinoTable) {
  return new Entity({
    name: "Config",
    table,
    schema: item({
      pk: string().key(),
      sk: string().key(),
      value: string(),
      updatedAt: number(),
    }),
    timestamps: false,
  });
}

// ── User ─────────────────────────────────────────────────────────────────────

export function createUserEntity(table: TinoTable) {
  return new Entity({
    name: "User",
    table,
    schema: item({
      pk: string().key(), // 'ORG#USER#<tinoUserId>'
      sk: string().key(), // same as pk (single-row partition)
      tinoUserId: string(),
      email: string(),
      name: string().optional(),
      role: string(), // 'admin' | 'member'
      status: string(), // 'active' | 'invited' | 'suspended'
      slackUserId: string().optional(),
      createdAt: number(),
      updatedAt: number(),
    }),
    timestamps: false,
  });
}

// ── Identity ─────────────────────────────────────────────────────────────────

export function createIdentityEntity(table: TinoTable) {
  return new Entity({
    name: "Identity",
    table,
    schema: item({
      pk: string().key(), // 'IDENTITY#<provider>#<externalId>'
      sk: string().key(), // same as pk
      provider: string(), // 'slack' | 'google'
      externalId: string(),
      tinoUserId: string(),
      linkedAt: number(),
    }),
    timestamps: false,
  });
}

// ── Key helpers ──────────────────────────────────────────────────────────────

/** Zero-pad a scheduledAt epoch-seconds value to 13 digits for lexicographic sort. */
export function padScheduledAt(epochSec: number): string {
  return String(epochSec).padStart(13, "0");
}
