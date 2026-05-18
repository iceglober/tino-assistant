import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { IdentityLinkConflictError, type IdentityStore } from "@tino/core/identity/store";
import type { Identity, IdentityProvider } from "@tino/core/identity/types";
import { GetItemCommand, PutItemCommand, QueryCommand } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";
import { createIdentityEntity } from "./entities.js";

/**
 * DynamoDB-backed IdentityStore.
 *
 * Key pattern: pk=IDENTITY#<provider>#<externalId>, sk=same (single-row
 * partition). Lookup by `(provider, externalId)` is an O(1) GetItem. Listing
 * identities for a tinoUserId is currently a best-effort Scan-equivalent — a
 * future wave adds a GSI on `tinoUserId` if the listForUser path becomes hot.
 *
 * Duplicate-link rejection is enforced by a `attribute_not_exists(pk)`
 * condition on PutItem. The thrown
 * `ConditionalCheckFailedException` is rewrapped as
 * `IdentityLinkConflictError` so callers can branch on the typed conflict.
 */
export function createDynamoIdentityStore(table: TinoTable): IdentityStore {
  const entity = createIdentityEntity(table);

  function identityPk(provider: IdentityProvider, externalId: string): string {
    return `IDENTITY#${provider}#${externalId}`;
  }

  return {
    async resolve(provider: IdentityProvider, externalId: string): Promise<string | null> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({
          pk: identityPk(provider, externalId),
          sk: identityPk(provider, externalId),
        })
        .send();
      return Item?.tinoUserId ?? null;
    },

    async link(identity: Identity): Promise<void> {
      try {
        await entity
          .build(PutItemCommand)
          .item({
            pk: identityPk(identity.provider, identity.externalId),
            sk: identityPk(identity.provider, identity.externalId),
            provider: identity.provider,
            externalId: identity.externalId,
            tinoUserId: identity.tinoUserId,
            linkedAt: identity.linkedAt,
          })
          .options({ condition: { attr: "pk", exists: false } })
          .send();
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
          throw new IdentityLinkConflictError(identity.provider, identity.externalId);
        }
        throw err;
      }
    },

    async listForUser(tinoUserId: string): Promise<Identity[]> {
      // Without a GSI on tinoUserId, this is a best-effort Scan. Wave 0 only
      // exercises listForUser in tests and the migration retry path, both of
      // which involve a single newly-created user with ≤2 identities, so the
      // cost is negligible. Add a GSI when admin UI / audit needs it.
      try {
        const { Items = [] } = await table.build(QueryCommand).entities(entity).query({ partition: "IDENTITY" }).send();
        return (Items as Array<Identity & { pk: string; sk: string }>)
          .filter((it) => it.tinoUserId === tinoUserId)
          .map((it) => ({
            provider: it.provider,
            externalId: it.externalId,
            tinoUserId: it.tinoUserId,
            linkedAt: it.linkedAt,
          }))
          .sort((a, b) => a.linkedAt - b.linkedAt);
      } catch {
        return [];
      }
    },
  };
}
