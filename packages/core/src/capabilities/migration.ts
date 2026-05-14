/**
 * One-time migration from env vars to capability configs.
 *
 * On first startup after the refactor, if the config table has no
 * `capability.*` keys but the old env vars are set, this function reads
 * them, constructs capability configs, and writes them to the config table.
 *
 * Subsequent startups read from the config table only.
 */
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import type { CapabilityConfig } from './types.js';

/** Subset of env vars that may contain legacy credentials. */
export interface LegacyEnv {
  GITHUB_TOKEN?: string;
  GITHUB_DEFAULT_REPO?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  SLACK_USER_TOKEN?: string;
  LINEAR_DEVELOPER_TOKEN?: string;
  AWS_REGION?: string;
}

export interface MigrationResult {
  migrated: string[];   // capability IDs that were written
  skipped: string[];    // capability IDs that had no env vars
  alreadyPresent: string[]; // capability IDs already in config table
}

/**
 * Run the migration. Safe to call on every startup — it is a no-op if
 * capability configs already exist in the config table.
 */
export async function migrateEnvToCapabilities(
  env: LegacyEnv,
  configStore: ConfigStore,
  logger: AppLogger,
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: [], skipped: [], alreadyPresent: [] };

  const capabilityIds = ['github', 'linear', 'slack', 'gmail', 'calendar', 'cloudwatch'];

  // Check which capabilities already have config entries
  for (const id of capabilityIds) {
    const existing = await configStore.get(`capability.${id}`);
    if (existing !== null) {
      result.alreadyPresent.push(id);
    }
  }

  // If ALL capabilities are already present, nothing to do
  if (result.alreadyPresent.length === capabilityIds.length) {
    logger.debug('capability migration: all capabilities already configured, skipping');
    return result;
  }

  // Build capability configs from env vars for capabilities not yet present
  const toMigrate: Array<{ id: string; config: CapabilityConfig }> = [];

  // github
  if (!result.alreadyPresent.includes('github') && env.GITHUB_TOKEN) {
    const settings: Record<string, unknown> = {};
    if (env.GITHUB_DEFAULT_REPO) {
      settings['defaultRepo'] = env.GITHUB_DEFAULT_REPO;
      settings['repos'] = [env.GITHUB_DEFAULT_REPO];
    }
    toMigrate.push({
      id: 'github',
      config: {
        enabled: true,
        credentials: { token: env.GITHUB_TOKEN },
        settings,
        findWork: { enabled: false, intervalMinutes: 15 },
      },
    });
  }

  // linear
  if (!result.alreadyPresent.includes('linear') && env.LINEAR_DEVELOPER_TOKEN) {
    toMigrate.push({
      id: 'linear',
      config: {
        enabled: true,
        credentials: { token: env.LINEAR_DEVELOPER_TOKEN },
        settings: {
          defaultTeamKey: 'GEN',
          autoPickupStates: ['backlog', 'unstarted'],
        },
        findWork: { enabled: true, intervalMinutes: 15 },
      },
    });
  }

  // slack
  if (!result.alreadyPresent.includes('slack') && env.SLACK_USER_TOKEN) {
    toMigrate.push({
      id: 'slack',
      config: {
        enabled: true,
        credentials: { userToken: env.SLACK_USER_TOKEN },
        settings: {},
        findWork: { enabled: false, intervalMinutes: 30 },
      },
    });
  }

  // gmail + calendar (share Google OAuth credentials)
  const hasGoogle = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!result.alreadyPresent.includes('gmail') && hasGoogle) {
    toMigrate.push({
      id: 'gmail',
      config: {
        enabled: true,
        credentials: {
          clientId: env.GOOGLE_OAUTH_CLIENT_ID!,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
          refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN!,
        },
        settings: {},
        findWork: { enabled: false, intervalMinutes: 30 },
      },
    });
  }

  if (!result.alreadyPresent.includes('calendar') && hasGoogle) {
    toMigrate.push({
      id: 'calendar',
      config: {
        enabled: true,
        credentials: {
          clientId: env.GOOGLE_OAUTH_CLIENT_ID!,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
          refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN!,
        },
        settings: { calendarId: 'primary' },
        findWork: { enabled: false, intervalMinutes: 60 },
      },
    });
  }

  // cloudwatch — uses AWS default credential chain, no explicit credentials needed
  if (!result.alreadyPresent.includes('cloudwatch')) {
    toMigrate.push({
      id: 'cloudwatch',
      config: {
        enabled: true,
        credentials: {},
        settings: {
          logGroups: [],
          region: env.AWS_REGION ?? '',
        },
        findWork: { enabled: false, intervalMinutes: 60 },
      },
    });
  }

  // Write migrated configs
  for (const { id, config } of toMigrate) {
    await configStore.set(`capability.${id}`, config);
    result.migrated.push(id);
    logger.info({ capabilityId: id }, 'capability migration: wrote config from env vars');
  }

  // Track skipped (no env vars, not already present)
  for (const id of capabilityIds) {
    if (!result.alreadyPresent.includes(id) && !result.migrated.includes(id)) {
      result.skipped.push(id);
    }
  }

  if (result.migrated.length > 0) {
    logger.info(
      { migrated: result.migrated, skipped: result.skipped },
      'capability migration complete — credentials moved from env vars to config table',
    );
  }

  return result;
}
