/**
 * Persistence assembly: one database handle, ensure-DDL, the platform-wide
 * stores (orgs, memberships), and `forOrg(id)` — the only way to reach an org's
 * data, returning stores that can't address any other org.
 *
 * Call it after better-auth has migrated its tables (`migrateAuth`): orgs,
 * members and invitations are the auth provider's, and tino's tables reference them.
 */
import type {
  ConfigStore,
  ConversationLog,
  CryptoAdapter,
  IdentityStore,
  InvitationStore,
  KnowledgeStore,
  Logger,
  MembershipDirectory,
  OrgStore,
  UserCapabilityStore,
  UserStore,
} from "@tino/core/ports/outbound";
import { createPgKnowledgeStore } from "../../kb/pg-store.js";
import type { PgPool } from "../db.js";
import { createPgConfigStore } from "./config.js";
import { createPgConversationLog } from "./conversation-log.js";
import { createPgInvitationStore, createPgMembershipDirectory, createPgOrgStore } from "./orgs.js";
import { ensureSchema } from "./schema.js";
import { createPgUserCapabilityStore } from "./user-capabilities.js";
import { createPgIdentityStore, createPgUserStore } from "./users.js";

/** Everything one org owns, bound to its id. */
export interface OrgStores {
  orgId: string;
  config: ConfigStore;
  users: UserStore;
  identities: IdentityStore;
  invitations: InvitationStore;
  userCapabilities: UserCapabilityStore;
  conversations: ConversationLog;
  /** The org's knowledge base, recording `embedModel` on what it writes. Null without pgvector. */
  knowledge: ((embedModel: string) => KnowledgeStore) | null;
}

export interface Persistence {
  pool: PgPool;
  orgs: OrgStore;
  memberships: MembershipDirectory;
  forOrg(orgId: string): OrgStores;
  /** Whether the knowledge-base tables exist (pgvector ≥ 0.7). */
  kbAvailable: boolean;
}

export async function createPersistence(
  pool: PgPool,
  logger: Logger,
  cryptoAdapter: CryptoAdapter,
): Promise<Persistence> {
  const { kb } = await ensureSchema(pool, logger);

  const cache = new Map<string, OrgStores>();
  const forOrg = (orgId: string): OrgStores => {
    let stores = cache.get(orgId);
    if (!stores) {
      stores = {
        orgId,
        config: createPgConfigStore({ pool, orgId, cryptoAdapter }),
        users: createPgUserStore({ pool, orgId }),
        identities: createPgIdentityStore({ pool, orgId }),
        invitations: createPgInvitationStore({ pool, orgId }),
        userCapabilities: createPgUserCapabilityStore({ pool, orgId, cryptoAdapter }),
        conversations: createPgConversationLog({ pool, orgId }),
        knowledge: kb ? (embedModel) => createPgKnowledgeStore({ pool, orgId, embedModel }) : null,
      };
      cache.set(orgId, stores);
    }
    return stores;
  };

  return {
    pool,
    orgs: createPgOrgStore({ pool }),
    memberships: createPgMembershipDirectory({ pool, configFor: (orgId) => forOrg(orgId).config }),
    forOrg,
    kbAvailable: kb,
  };
}
