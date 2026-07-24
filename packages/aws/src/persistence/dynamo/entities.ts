import { Entity, item, number, string } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";

/**
 * DynamoDB Toolbox v2 entity definitions for all stores.
 *
 * Key patterns:
 *   History:    pk=HISTORY#<userId>             sk=HISTORY
 *   Config:     pk=CONFIG                       sk=CONFIG#<key>
 *   User:       pk=ORG#USER#<tinoUserId>        sk=ORG#USER#<tinoUserId>
 *   Identity:   pk=IDENTITY#<provider>#<externalId>  sk=same
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

// ── User Capability ──────────────────────────────────────────────────────────

export function createUserCapabilityEntity(table: TinoTable) {
  return new Entity({
    name: "UserCapability",
    table,
    schema: item({
      pk: string().key(), // 'USER#<tinoUserId>'
      sk: string().key(), // 'CAP#<capabilityId>'
      tinoUserId: string(),
      capabilityId: string(),
      enabled: number(), // 0 or 1 (boolean)
      credentialsJson: string().optional(),
      settingsJson: string().optional(),
      updatedAt: number(),
    }),
    timestamps: false,
  });
}

// ── Session (better-auth SecondaryStorage) ──────────────────────────────────

export function createSessionEntity(table: TinoTable) {
  return new Entity({
    name: "Session",
    table,
    schema: item({
      pk: string().key(), // 'SESSION#<key>'
      sk: string().key(), // same as pk
      value: string(),
      expiresAt: number().optional(),
      updatedAt: number(),
    }),
    timestamps: false,
  });
}
