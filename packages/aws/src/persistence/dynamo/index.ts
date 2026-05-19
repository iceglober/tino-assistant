import type { HistoryStore } from "@tino/core/agent/history";
import type { AuditLogger } from "@tino/core/audit/logger";
import type { CryptoAdapter } from "@tino/core/crypto/types";
import type { Env } from "@tino/core/env";
import type { IdentityStore, UserStore } from "@tino/core/identity/store";
import type { ConfigStore } from "@tino/core/persistence/config";
import type { PreferencesStore } from "@tino/core/persistence/preferences";
import type { TaskStore } from "@tino/core/persistence/tasks";
import type { UserCapabilityStore } from "@tino/core/persistence/user-capabilities";
import type { AppLogger } from "@tino/core/slack/app";
import { createDynamoAuditLogger } from "../../audit/dynamo.js";
import { createDynamoTable } from "./client.js";
import { createDynamoConfigStore } from "./config.js";
import { createDynamoHistoryStore } from "./history.js";
import { createDynamoIdentityStore } from "./identities.js";
import { createDynamoPreferencesStore } from "./preferences.js";
import { createDynamoTaskStore } from "./tasks.js";
import { createDynamoUserStore } from "./users.js";
import { createDynamoUserCapabilityStore } from "./user-capabilities.js";
import { createDynamoSessionStore, type SessionSecondaryStorage } from "./session-store.js";

export interface DynamoPersistence {
  history: HistoryStore;
  tasks: TaskStore;
  preferences: PreferencesStore;
  config: ConfigStore;
  users: UserStore;
  identities: IdentityStore;
  userCapabilities: UserCapabilityStore;
  auditLogger: AuditLogger;
  sessionStore: SessionSecondaryStorage;
}

/**
 * Default audit retention: 90 days. Matches `DEFAULT_RETENTION_SECONDS` in
 * `audit/dynamo.ts:22` and `tino.deploy.json hipaa.auditRetentionDays`.
 *
 * If `AUDIT_RETENTION_DAYS` is set in the environment (passed through from
 * the deploy config when the Pulumi component is rolled), use that instead.
 */
const DEFAULT_AUDIT_RETENTION_DAYS = 90;

function readAuditRetentionSeconds(): number {
  const raw = process.env.AUDIT_RETENTION_DAYS;
  if (!raw) return DEFAULT_AUDIT_RETENTION_DAYS * 86400;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    return DEFAULT_AUDIT_RETENTION_DAYS * 86400;
  }
  return Math.floor(days) * 86400;
}

export async function createDynamoPersistence(
  env: Env,
  logger: AppLogger,
  cryptoAdapter?: CryptoAdapter,
): Promise<DynamoPersistence> {
  const tableName = env.DYNAMODB_TABLE_NAME;
  if (!tableName) {
    throw new Error("DYNAMODB_TABLE_NAME env var is required when PERSISTENCE_ADAPTER=dynamodb");
  }

  const endpoint = env.DYNAMODB_ENDPOINT;
  const table = await createDynamoTable(tableName, endpoint);

  if (!cryptoAdapter) {
    throw new Error("CryptoAdapter is required for DynamoDB persistence layer");
  }

  const retentionSeconds = readAuditRetentionSeconds();
  logger.info(
    {
      adapter: "dynamodb",
      tableName,
      endpoint: endpoint ?? "(aws default)",
      local: !!endpoint,
      auditRetentionDays: Math.round(retentionSeconds / 86400),
    },
    "persistence initialized",
  );

  return {
    history: createDynamoHistoryStore(table),
    tasks: createDynamoTaskStore(table),
    preferences: createDynamoPreferencesStore(table),
    config: createDynamoConfigStore(table),
    users: createDynamoUserStore(table),
    identities: createDynamoIdentityStore(table),
    userCapabilities: createDynamoUserCapabilityStore(table, cryptoAdapter),
    auditLogger: createDynamoAuditLogger(table, retentionSeconds),
    sessionStore: createDynamoSessionStore(table),
  };
}
