import type { HistoryStore } from "@tino/core/ports";
import type { CryptoAdapter } from "@tino/core/ports";
import type { Env } from "@tino/core/env";
import type { IdentityStore, UserStore } from "@tino/core/ports";
import type { ConfigStore } from "@tino/core/ports";
import type { UserCapabilityStore } from "@tino/core/ports";
import type { Logger } from "@tino/core/ports";
import { createDynamoTable } from "./client.js";
import { createDynamoConfigStore } from "./config.js";
import { createDynamoHistoryStore } from "./history.js";
import { createDynamoIdentityStore } from "./identities.js";
import { createDynamoUserStore } from "./users.js";
import { createDynamoUserCapabilityStore } from "./user-capabilities.js";
import { createDynamoSessionStore, type SessionSecondaryStorage } from "./session-store.js";

export interface DynamoPersistence {
  history: HistoryStore;
  config: ConfigStore;
  users: UserStore;
  identities: IdentityStore;
  userCapabilities: UserCapabilityStore;
  sessionStore: SessionSecondaryStorage;
}

export async function createDynamoPersistence(
  env: Env,
  logger: Logger,
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

  logger.info(
    {
      adapter: "dynamodb",
      tableName,
      endpoint: endpoint ?? "(aws default)",
      local: !!endpoint,
    },
    "persistence initialized",
  );

  return {
    history: createDynamoHistoryStore(table),
    config: createDynamoConfigStore(table),
    users: createDynamoUserStore(table),
    identities: createDynamoIdentityStore(table),
    userCapabilities: createDynamoUserCapabilityStore(table, cryptoAdapter),
    sessionStore: createDynamoSessionStore(table),
  };
}
