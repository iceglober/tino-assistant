import type { UserCapabilityStore } from "@tino/core/persistence/user-capabilities";
import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "@tino/core/crypto/types";
import type { CapabilityConfig } from "@tino/core/capabilities/types";
import { CAP_SK_PREFIX, capabilitySk as makeCapSk, userCapPk } from "@tino/core/persistence/keys";
import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";
import { createUserCapabilityEntity } from "./entities.js";

/**
 * DynamoDB-backed UserCapabilityStore.
 *
 * Key pattern: pk=USER#<tinoUserId>, sk=CAP#<capabilityId>
 * list() issues a single-partition Query on pk=USER#<tinoUserId>
 * with range beginsWith CAP#.
 *
 * Credentials are encrypted per-field with userId+capabilityId+fieldName context.
 */
export function createDynamoUserCapabilityStore(
  table: TinoTable,
  cryptoAdapter: CryptoAdapter,
): UserCapabilityStore {
  const entity = createUserCapabilityEntity(table);

  function userPk(tinoUserId: string): string {
    return userCapPk(tinoUserId);
  }

  function capabilitySk(capabilityId: string): string {
    return makeCapSk(capabilityId);
  }

  async function encryptCredentials(
    credentials: Record<string, string>,
    userId: string,
    capabilityId: string,
  ): Promise<Record<string, EnvelopeCiphertext>> {
    const encrypted: Record<string, EnvelopeCiphertext> = {};
    for (const [key, value] of Object.entries(credentials)) {
      const context: EncryptionContext = { userId, capabilityId, fieldName: key };
      encrypted[key] = await cryptoAdapter.encrypt(value, context);
    }
    return encrypted;
  }

  async function decryptCredentials(
    encryptedRecord: Record<string, EnvelopeCiphertext>,
    userId: string,
    capabilityId: string,
  ): Promise<Record<string, string>> {
    const decrypted: Record<string, string> = {};
    for (const [key, envelope] of Object.entries(encryptedRecord)) {
      const context: EncryptionContext = { userId, capabilityId, fieldName: key };
      decrypted[key] = await cryptoAdapter.decrypt(envelope, context);
    }
    return decrypted;
  }

  return {
    async get(userId: string, capabilityId: string): Promise<CapabilityConfig | null> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: userPk(userId), sk: capabilitySk(capabilityId) })
        .send();

      if (!Item) return null;

      const row = Item as {
        enabled: number;
        credentialsJson?: string;
        settingsJson?: string;
      };

      const encryptedCredentials = row.credentialsJson ? JSON.parse(row.credentialsJson) : {};
      const settings = row.settingsJson ? JSON.parse(row.settingsJson) : {};

      const credentials = await decryptCredentials(encryptedCredentials, userId, capabilityId);

      return {
        enabled: row.enabled === 1,
        credentials,
        settings,
      };
    },

    async set(userId: string, capabilityId: string, config: CapabilityConfig): Promise<void> {
      const encryptedCredentials = await encryptCredentials(config.credentials, userId, capabilityId);
      const credentialsJson = JSON.stringify(encryptedCredentials);
      const settingsJson = JSON.stringify(config.settings);

      await entity
        .build(PutItemCommand)
        .item({
          pk: userPk(userId),
          sk: capabilitySk(capabilityId),
          tinoUserId: userId,
          capabilityId,
          enabled: config.enabled ? 1 : 0,
          credentialsJson,
          settingsJson,
          updatedAt: Date.now(),
        })
        .send();
    },

    async list(userId: string): Promise<Array<{ capabilityId: string; enabled: boolean }>> {
      const { Items = [] } = await table
        .build(QueryCommand)
        .entities(entity)
        .query({
          partition: userPk(userId),
          range: { beginsWith: CAP_SK_PREFIX },
        })
        .send();

      return (Items as Array<{ sk: string; enabled: number }>)
        .map((item) => ({
          capabilityId: item.sk.replace(new RegExp(`^${CAP_SK_PREFIX}`), ""),
          enabled: item.enabled === 1,
        }))
        .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
    },

    async delete(userId: string, capabilityId: string): Promise<boolean> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: userPk(userId), sk: capabilitySk(capabilityId) })
        .send();

      if (!Item) return false;

      await entity
        .build(DeleteItemCommand)
        .key({ pk: userPk(userId), sk: capabilitySk(capabilityId) })
        .send();

      return true;
    },
  };
}
