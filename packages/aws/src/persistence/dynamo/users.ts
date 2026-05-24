import type { UserStore } from "@tino/core/identity/store";
import type { TinoUser } from "@tino/core/identity/types";
import { ORG_USER_PARTITION, orgUserPk } from "@tino/core/persistence/keys";
import { GetItemCommand, PutItemCommand, ScanCommand, UpdateItemCommand } from "dynamodb-toolbox";
import type { TinoTable } from "./client.js";
import { createUserEntity } from "./entities.js";

/**
 * DynamoDB-backed UserStore.
 *
 * Key pattern: pk=ORG#USER#<tinoUserId>, sk=ORG#USER#<tinoUserId>
 * (single-row partition). This shape is OSS-friendly today and ready for a
 * future TENANT#<id># prefix without a partition reshape.
 *
 * `getByEmail` and `list` use a Query against pk-prefix `ORG#USER#`. Email
 * lookups are case-insensitive at the application layer (compared after
 * lowercasing), since DynamoDB has no native case-folding query.
 */
export function createDynamoUserStore(table: TinoTable): UserStore {
  const entity = createUserEntity(table);

  function userPk(id: string): string {
    return orgUserPk(id);
  }

  function rowToUser(item: {
    tinoUserId: string;
    email: string;
    name?: string;
    role: string;
    status: string;
    slackUserId?: string;
    createdAt: number;
    updatedAt: number;
  }): TinoUser {
    return {
      id: item.tinoUserId,
      email: item.email,
      name: item.name,
      role: item.role as TinoUser["role"],
      status: item.status as TinoUser["status"],
      slackUserId: item.slackUserId ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  return {
    async create(user: TinoUser): Promise<TinoUser> {
      // condition: attr 'pk' must not exist — refuses to silently overwrite an
      // existing user record. Mirrors the pattern we'll use for identities.
      await entity
        .build(PutItemCommand)
        .item({
          pk: userPk(user.id),
          sk: userPk(user.id),
          tinoUserId: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          slackUserId: user.slackUserId ?? undefined,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .options({ condition: { attr: "pk", exists: false } })
        .send();
      return user;
    },

    async get(id: string): Promise<TinoUser | null> {
      const { Item } = await entity
        .build(GetItemCommand)
        .key({ pk: userPk(id), sk: userPk(id) })
        .send();
      return Item ? rowToUser(Item) : null;
    },

    async getByEmail(email: string): Promise<TinoUser | null> {
      const target = email.toLowerCase();
      const { Items = [] } = await table
        .build(ScanCommand)
        .entities(entity)
        .options({
          filters: { User: { attr: "pk", beginsWith: `${ORG_USER_PARTITION}#` } },
        })
        .send()
        .catch(() => ({ Items: [] }));
      const match = (Items as Array<Parameters<typeof rowToUser>[0]>).find((it) => it.email.toLowerCase() === target);
      return match ? rowToUser(match) : null;
    },

    async list(): Promise<TinoUser[]> {
      try {
        const { Items = [] } = await table
          .build(ScanCommand)
          .entities(entity)
          .options({
            filters: { User: { attr: "pk", beginsWith: `${ORG_USER_PARTITION}#` } },
          })
          .send();
        return (Items as Array<Parameters<typeof rowToUser>[0]>)
          .map(rowToUser)
          .sort((a, b) => a.createdAt - b.createdAt);
      } catch {
        return [];
      }
    },

    async update(
      id: string,
      patch: Partial<Pick<TinoUser, "role" | "status" | "slackUserId" | "name">>,
    ): Promise<TinoUser> {
      // Build an item with only the changed fields plus the required key
      // attributes. The toolbox UpdateItemCommand requires `pk`/`sk` to be
      // typed strings (not unknown), so we declare the shape explicitly and
      // only set the optional fields that the caller actually patched.
      const updateItem: {
        pk: string;
        sk: string;
        updatedAt: number;
        role?: string;
        status?: string;
        slackUserId?: string;
        name?: string;
      } = {
        pk: userPk(id),
        sk: userPk(id),
        updatedAt: Date.now(),
      };
      if (patch.role !== undefined) updateItem.role = patch.role;
      if (patch.status !== undefined) updateItem.status = patch.status;
      if (patch.slackUserId !== undefined && patch.slackUserId !== null) updateItem.slackUserId = patch.slackUserId;
      if (patch.name !== undefined) updateItem.name = patch.name;

      await entity
        .build(UpdateItemCommand)
        .item(updateItem)
        .options({ condition: { attr: "pk", exists: true } })
        .send();

      const fresh = await this.get(id);
      if (!fresh) throw new Error(`tino_user not found after update: ${id}`);
      return fresh;
    },
  };
}
