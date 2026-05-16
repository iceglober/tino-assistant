import { Entity, item, number, string } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";

/**
 * DynamoDB Toolbox v2 entity definitions for all four stores.
 *
 * Key patterns:
 *   History:    pk=HISTORY#<userId>  sk=HISTORY
 *   Task:       pk=TASK#<taskId>     sk=TASK
 *   Preference: pk=PREF#<userId>     sk=PREF#<key>
 *   Config:     pk=CONFIG            sk=CONFIG#<key>
 *
 * GSI1 (tasks only):
 *   gsi1pk=TASK_STATUS#<status>  gsi1sk=<scheduledAt zero-padded 13 digits>
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

// ── Key helpers ──────────────────────────────────────────────────────────────

/** Zero-pad a scheduledAt epoch-seconds value to 13 digits for lexicographic sort. */
export function padScheduledAt(epochSec: number): string {
  return String(epochSec).padStart(13, "0");
}
