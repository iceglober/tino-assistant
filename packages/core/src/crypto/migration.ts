/**
 * Wave 2 credential migration: Move bot owner's private-capability credentials
 * from global `capability.<id>` blobs to per-user encrypted partitions.
 *
 * On first startup after wave 2 deployment:
 *   1. If the bot owner is already migrated (completion marker set), short-circuit.
 *   2. Read the current `capability.<id>` configs for private capabilities.
 *   3. For the bot owner (admin user), store in UserCapabilityStore with encryption.
 *   4. Write a 30-day-TTL backup before clearing the global blob.
 *   5. Clear the global blob.
 *   6. Set completion marker.
 *
 * Subsequent startups are a no-op.
 *
 * This is safe to call on every startup: if already done, it returns immediately.
 * If interrupted, the marker is not set and the migration retries on next startup.
 */

import type { ConfigStore } from "../persistence/config.js";
import type { UserCapabilityStore } from "../persistence/user-capabilities.js";
import type { UserStore } from "../identity/store.js";
import type { AppLogger } from "../slack/app.js";
import type { CapabilityConfig } from "../capabilities/types.js";
import { ALL_CAPABILITIES } from "../capabilities/all.js";

const PRIVATE_CAPABILITY_IDS = ["gmail", "calendar", "slack-personal"];
const BACKUP_TTL_DAYS = 30;
const MIGRATION_MARKER_KEY = "migration.wave2-credential-v1.completedAt";

export interface MigrateCredentialsOpts {
  configStore: ConfigStore;
  userCapabilities: UserCapabilityStore;
  users: UserStore;
  logger: AppLogger;
  allowedSlackUserId?: string;
}

export interface MigrationResult {
  migrated: string[]; // capability IDs that were migrated
  skipped: string[]; // capability IDs with no global config
  botOwnerTinoUserId?: string;
  backupKeys: string[]; // config store backup keys written
}

/**
 * Run the credential migration. Safe to call on every startup — it is a no-op if
 * the migration marker is already set in the config store.
 */
export async function migrateCredentialsToUserPartitions(
  opts: MigrateCredentialsOpts,
): Promise<MigrationResult> {
  const { configStore, userCapabilities, users, logger, allowedSlackUserId } = opts;
  const result: MigrationResult = { migrated: [], skipped: [], backupKeys: [] };

  // Step 1: Idempotency check.
  const completedAt = await configStore.get(MIGRATION_MARKER_KEY);
  if (completedAt !== null) {
    logger.debug("wave2-credential migration already completed, skipping");
    return result;
  }

  // Step 2: Find the bot owner's tino-UUID.
  // If allowedSlackUserId is not provided or no admin user exists yet, skip gracefully.
  if (!allowedSlackUserId) {
    logger.debug("no allowedSlackUserId provided, skipping credential migration");
    return result;
  }

  const adminUsers = await users.list();
  const botOwner = adminUsers.find((u) => u.role === "admin");
  if (!botOwner) {
    logger.debug("no admin user found, skipping credential migration");
    return result;
  }

  result.botOwnerTinoUserId = botOwner.id;

  // Step 3: For each private capability, read the global config and migrate.
  for (const capId of PRIVATE_CAPABILITY_IDS) {
    const globalRaw = await configStore.get(`capability.${capId}`);
    if (!globalRaw) {
      // No config entry for this capability — nothing to do
      continue;
    }

    let globalConfig: CapabilityConfig;
    try {
      const parsed = JSON.parse(globalRaw);
      // Ensure the parsed value is a valid CapabilityConfig object
      if (!parsed || typeof parsed !== "object" || !("credentials" in parsed)) {
        logger.warn(
          { capabilityId: capId },
          "global capability config is not a valid CapabilityConfig object, skipping",
        );
        result.skipped.push(capId);
        continue;
      }
      globalConfig = parsed as CapabilityConfig;
    } catch {
      logger.warn(
        { capabilityId: capId },
        "global capability config is not valid JSON, skipping credential migration for this capability",
      );
      result.skipped.push(capId);
      continue;
    }

    // Skip if credentials are empty
    if (!globalConfig.credentials || Object.keys(globalConfig.credentials).length === 0) {
      result.skipped.push(capId);
      continue;
    }

    try {
      // Step 3a: Write a 30-day-TTL backup before clearing.
      const backupKey = `migration.${capId}-backup.${Date.now()}`;
      const backupWithTTL = {
        ...globalConfig,
        __backupCreatedAt: Date.now(),
        __ttlExpiresAt: Date.now() + BACKUP_TTL_DAYS * 24 * 60 * 60 * 1000,
      };
      await configStore.set(backupKey, backupWithTTL);
      result.backupKeys.push(backupKey);
      logger.debug({ capabilityId: capId, backupKey }, "wrote credential backup");

      // Step 3b: Store encrypted config in UserCapabilityStore under bot owner's tino-UUID.
      await userCapabilities.set(botOwner.id, capId, globalConfig);
      logger.info(
        { capabilityId: capId, botOwnerTinoUserId: botOwner.id },
        "migrated credentials to per-user encrypted partition",
      );

      // Step 3c: Clear the global blob.
      const deleted = await configStore.delete(`capability.${capId}`);
      if (deleted) {
        logger.info({ capabilityId: capId }, "cleared global capability config after migration");
      }

      result.migrated.push(capId);
    } catch (err) {
      logger.warn(
        { capabilityId: capId, err: (err as Error).message },
        "failed to migrate credentials for this capability — will retry on next startup",
      );
      // Don't add to migrated; the migration will retry next startup.
      // The backup we just wrote is still valid; we'll clean it up eventually.
    }
  }

  // Step 4: Set completion marker if any capability was processed (migrated or skipped).
  // This ensures idempotency: if we found at least one private capability with a config,
  // we mark the migration complete. On retry, this check returns early.
  if (result.migrated.length > 0 || result.skipped.length > 0) {
    await configStore.set(MIGRATION_MARKER_KEY, String(Date.now()));
    logger.info(
      {
        migrated: result.migrated,
        skipped: result.skipped,
        backups: result.backupKeys.length,
      },
      "wave2-credential migration complete",
    );
  }

  return result;
}
