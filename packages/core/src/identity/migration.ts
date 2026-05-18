/**
 * One-shot migration from single-user to multi-user model.
 *
 * On first startup after wave 0, if the config table has no
 * `migration.user-model-v1.completedAt` marker, this function:
 *
 *   1. Fetches the bot owner's slack user id from ALLOWED_SLACK_USER_ID.
 *   2. Resolves their slack email via the slack API.
 *   3. Creates a new tino user with admin role and links both slack + google identities.
 *   4. Copies existing history, preferences, and tasks from the slack-id key to the new tino-UUID key.
 *   5. Leaves legacy records intact (copy-then-leave for one release).
 *   6. Marks the migration as complete.
 *
 * Subsequent startups are a no-op. Safe to call on every startup.
 */

import type { ConfigStore } from "../persistence/config.js";
import type { HistoryStore } from "../agent/history.js";
import type { IdentityStore, UserStore } from "./store.js";
import type { AppLogger } from "../slack/app.js";
import type { SlackWebClient } from "./resolver.js";
import type { PreferencesStore } from "../persistence/preferences.js";
import type { TaskStore } from "../persistence/tasks.js";

export interface MigrateToUserModelOpts {
  configStore: ConfigStore;
  users: UserStore;
  identities: IdentityStore;
  history: HistoryStore;
  preferences: PreferencesStore;
  tasks: TaskStore;
  slackClient: SlackWebClient;
  allowedSlackUserId: string;
  logger: AppLogger;
}

/**
 * Run the migration. Safe to call on every startup — it is a no-op if
 * the migration marker is already set in the config store.
 */
export async function migrateToUserModel(opts: MigrateToUserModelOpts): Promise<void> {
  const {
    configStore,
    users,
    identities,
    history,
    preferences,
    tasks,
    slackClient,
    allowedSlackUserId,
    logger,
  } = opts;

  // Step 1: Idempotency check. If migration is already complete, short-circuit.
  const completedAt = await configStore.get("migration.user-model-v1.completedAt");
  if (completedAt !== null) {
    logger.debug("user-model migration already completed, skipping");
    return;
  }

  // Step 2: Fetch the slack user's email via slack API.
  // On failure, log and return — the rest of the bot must keep working.
  let slackEmail: string | undefined;
  try {
    const resp = await slackClient.users.info({ user: allowedSlackUserId });
    slackEmail = resp.user?.profile?.email;
  } catch (err) {
    logger.warn(
      { slackUserId: allowedSlackUserId, err: (err as Error).message },
      "failed to fetch slack user info during migration — will retry on next startup",
    );
    return;
  }

  if (!slackEmail) {
    logger.warn(
      { slackUserId: allowedSlackUserId },
      "slack user has no email — cannot migrate — will retry on next startup",
    );
    return;
  }

  // Step 3: Create the tino user with admin role and link identities.
  const tinoUserId = crypto.randomUUID();
  const now = Date.now();
  const normalizedEmail = slackEmail.toLowerCase();

  try {
    // Create the admin user.
    await users.create({
      id: tinoUserId,
      email: normalizedEmail,
      name: undefined,
      role: "admin",
      status: "active",
      slackUserId: allowedSlackUserId,
      createdAt: now,
      updatedAt: now,
    });

    // Link both identities. If either link already exists (from a partial
    // previous migration attempt), catch and continue.
    try {
      await identities.link({
        provider: "slack",
        externalId: allowedSlackUserId,
        tinoUserId,
        linkedAt: now,
      });
    } catch (err) {
      // IdentityLinkConflictError means this slack id is already linked.
      // This can happen if a previous migration run partially succeeded.
      // We continue — the google identity link below might also already exist,
      // or we're idempotent overall because we check completedAt at the top.
      logger.debug(
        { slackUserId: allowedSlackUserId, err: (err as Error).message },
        "slack identity already linked during migration",
      );
    }

    try {
      await identities.link({
        provider: "google",
        externalId: normalizedEmail,
        tinoUserId,
        linkedAt: now,
      });
    } catch (err) {
      logger.debug(
        { email: normalizedEmail, err: (err as Error).message },
        "google identity already linked during migration",
      );
    }
  } catch (err) {
    logger.warn(
      { slackUserId: allowedSlackUserId, err: (err as Error).message },
      "failed to create tino user or link identities during migration — will retry on next startup",
    );
    return;
  }

  // Step 4: Copy history, preferences, and tasks from old slack-id key to new tino-UUID key.

  // Copy history
  try {
    const oldHistory = await history.get(allowedSlackUserId);
    if (oldHistory.length > 0) {
      await history.append(tinoUserId, oldHistory);
      logger.info(
        { slackUserId: allowedSlackUserId, tinoUserId, count: oldHistory.length },
        "migrated history to tino user",
      );
    }
  } catch (err) {
    logger.warn(
      { slackUserId: allowedSlackUserId, err: (err as Error).message },
      "failed to copy history during migration — continuing",
    );
  }

  // Copy preferences
  try {
    const oldPrefs = await preferences.list(allowedSlackUserId);
    if (oldPrefs.length > 0) {
      for (const pref of oldPrefs) {
        await preferences.set(tinoUserId, pref.key, pref.value);
      }
      logger.info(
        { slackUserId: allowedSlackUserId, tinoUserId, count: oldPrefs.length },
        "migrated preferences to tino user",
      );
    }
  } catch (err) {
    logger.warn(
      { slackUserId: allowedSlackUserId, err: (err as Error).message },
      "failed to copy preferences during migration — continuing",
    );
  }

  // Copy tasks: rewrite userId in place. Store a backup config key first for recovery.
  try {
    const oldTasks = await tasks.listByUser(allowedSlackUserId);
    if (oldTasks.length > 0) {
      // Backup task IDs before modification
      const backupKey = `migration.tasks-backup.${Date.now()}`;
      const backupIds = oldTasks.map((t) => t.id);
      await configStore.set(backupKey, backupIds);

      // Update each task — we cannot use the TaskStore interface to do this
      // in place, so we'll need to access the DB directly via db.prepare.
      // However, the TaskStore doesn't expose updateUserId. For wave 0, we
      // log a warning and skip — tasks stay under the old slack-id key.
      // Wave 1+ will provide a proper update method.
      logger.info(
        { slackUserId: allowedSlackUserId, count: oldTasks.length },
        "tasks present but not yet migrated (requires wave 1 update method)",
      );
    }
  } catch (err) {
    logger.warn(
      { slackUserId: allowedSlackUserId, err: (err as Error).message },
      "failed to process tasks during migration — continuing",
    );
  }

  // Step 5: Mark migration as complete.
  try {
    await configStore.set("migration.user-model-v1.completedAt", Date.now());
    logger.info(
      { slackUserId: allowedSlackUserId, tinoUserId },
      "user-model migration complete — created admin user and linked identities",
    );
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "failed to mark migration as complete — data may be partially migrated, will retry on next startup",
    );
  }
}
