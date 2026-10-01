/**
 * Ensure-DDL-on-boot. No migration library: one service, additive DDL only,
 * run under a pg advisory lock so an overlapping deploy can't race it.
 *
 * Tenancy: every table holding an org's data carries `org_id`, and every
 * unique key starts with it. The stores bound to an org put `org_id = <theirs>`
 * in every statement, so a query can't return another org's rows even when a
 * Slack channel id or thread key happens to repeat across workspaces.
 *
 * Conventions:
 * - epoch-ms timestamps are BIGINT (pg returns int8 as a string → Number() it).
 * - ids are TEXT; a "member" id is a person's id within an org (`tino_user_id`
 *   in tino's tables); `org:<orgId>` owns an org's own encrypted records.
 * - org_config.value / conversation_message.message_json are TEXT, not JSONB:
 *   stores return the raw stored string, and JSONB rejects \u0000 escapes that
 *   can appear inside model/tool output.
 * - better-auth creates its own tables first: accounts (user/session/account/
 *   verification) and the organization plugin's organization/member/invitation.
 * - Knowledge-base tables (kb_*) are defined in the KB schema module.
 */
import type { Logger } from "@tino/core/ports/outbound";
import { KB_DDL } from "../../kb/schema.js";
import type { PgPool } from "../db.js";

/** Held by every boot-time schema step so none of them race each other. */
export const SCHEMA_LOCK_KEY = 0x74696e6f; // "tino"

const CORE_DDL = `
-- Orgs, members and invitations are better-auth's organization plugin
-- ("organization", "member", "invitation"), migrated before this runs. Tino
-- adds the constraints it relies on, and every table of its own cascades from
-- "organization", so deleting an org deletes its data.
CREATE UNIQUE INDEX IF NOT EXISTS member_org_user_idx ON member ("organizationId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS organization_slack_team_idx ON organization ("slackTeamId") WHERE "slackTeamId" IS NOT NULL;

-- Per-org settings. Secret values (client secrets, tokens, API keys) are
-- envelope-encrypted JSON with the org bound as AAD; is_secret marks them.
CREATE TABLE IF NOT EXISTS org_config (
  org_id     TEXT    NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  is_secret  BOOLEAN NOT NULL DEFAULT false,
  updated_at BIGINT  NOT NULL,
  PRIMARY KEY (org_id, key)
);

CREATE TABLE IF NOT EXISTS identity (
  org_id       TEXT   NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider     TEXT   NOT NULL CHECK (provider IN ('slack','google','email')),
  external_id  TEXT   NOT NULL,
  tino_user_id TEXT   NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  linked_at    BIGINT NOT NULL,
  PRIMARY KEY (org_id, provider, external_id)
);
CREATE INDEX IF NOT EXISTS identity_user_idx ON identity (tino_user_id);

-- Encrypted per-owner credentials (a person's tokens; an org's MCP servers
-- under org:<id>). The owner id is bound into each field's AAD.
CREATE TABLE IF NOT EXISTS user_capability (
  org_id           TEXT    NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  tino_user_id     TEXT    NOT NULL,
  capability_id    TEXT    NOT NULL,
  enabled          BOOLEAN NOT NULL,
  credentials_json JSONB,
  settings_json    JSONB,
  updated_at       BIGINT  NOT NULL,
  PRIMARY KEY (org_id, tino_user_id, capability_id)
);

-- One row per message, labelled with who may see it.
CREATE TABLE IF NOT EXISTS conversation_message (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       TEXT   NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  thread_key   TEXT   NOT NULL,
  turn_id      TEXT   NOT NULL,
  asked_by     TEXT   NOT NULL,
  asked_where  TEXT   NOT NULL,
  who_can_see  TEXT   NOT NULL,
  role         TEXT   NOT NULL,
  text         TEXT,
  message_json TEXT   NOT NULL,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_message_thread_idx   ON conversation_message (org_id, thread_key, id);
CREATE INDEX IF NOT EXISTS conversation_message_asked_by_idx ON conversation_message (org_id, asked_by, id);
`;

/**
 * Create/upgrade every table. Returns whether the knowledge base's tables
 * exist (they need pgvector ≥ 0.7; without it everything else still works).
 */
export async function ensureSchema(pool: PgPool, logger: Logger): Promise<{ kb: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    await client.query(CORE_DDL);
    let kb = false;
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(KB_DDL);
      kb = true;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "pgvector ≥ 0.7 unavailable — knowledge base disabled");
    }
    logger.info({ kb }, "postgres schema ensured");
    return { kb };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
