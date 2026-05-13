/**
 * Capability registry — loads capabilities from the config store, registers
 * tools, and starts findWork pollers.
 *
 * Also registers the non-capability tools (preferences, tasks) that are
 * always available regardless of capability config.
 */
import type { ToolSet } from 'ai';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import type { TaskStore } from '../persistence/tasks.js';
import type { CapabilityConfig, CapabilityModule, CapabilityRegistry, CapabilityRuntimeState } from './types.js';
import { createPreferencesStore } from '../persistence/preferences.js';
import { setPreferenceTool, getPreferencesTool } from '../tools/preferences.js';
import { scheduleTaskTool, listTasksTool, cancelTaskTool } from '../tools/tasks.js';
import { githubCapability } from './github.js';
import { linearCapability } from './linear.js';
import { slackCapability } from './slack.js';
import { gmailCapability } from './gmail.js';
import { calendarCapability } from './calendar.js';
import { cloudwatchCapability } from './cloudwatch.js';

/** All capability modules in registration order. */
const ALL_CAPABILITIES: CapabilityModule[] = [
  githubCapability,
  linearCapability,
  slackCapability,
  gmailCapability,
  calendarCapability,
  cloudwatchCapability,
];

export interface RegistryOptions {
  configStore: ConfigStore;
  logger: AppLogger;
  /** ALLOWED_SLACK_USER_ID — needed for preferences and task tools. */
  allowedUserId: string;
  /** DB path for preferences store (SQLite only). */
  dbPath?: string;
  /** Task store for schedule_task / list_tasks / cancel_task tools. */
  taskStore?: TaskStore;
  /**
   * Called when a findWork poller discovers new work.
   * Receives a summary string describing the work item.
   */
  onNewWork?: (summary: string) => Promise<void>;
}

/**
 * Initialize the capability registry.
 *
 * Reads each `capability.<id>` key from the config store. For enabled
 * capabilities with credentials, calls registerTools. For capabilities with
 * findWork.enabled=true, starts the poller.
 */
export async function initCapabilityRegistry(opts: RegistryOptions): Promise<CapabilityRegistry> {
  const { configStore, logger, allowedUserId, dbPath, taskStore, onNewWork } = opts;
  const tools: ToolSet = {};
  const stopFns: Array<() => void> = [];
  const state: Record<string, CapabilityRuntimeState> = {};
  const loadedCapabilityIds: string[] = [];

  // ── Capability tools ──────────────────────────────────────────────────────
  for (const cap of ALL_CAPABILITIES) {
    const raw = await configStore.get(`capability.${cap.id}`);
    if (raw === null) {
      // No config entry — capability is unconfigured, skip silently
      state[cap.id] = { toolCount: 0 };
      continue;
    }

    let config: CapabilityConfig;
    try {
      config = JSON.parse(raw) as CapabilityConfig;
    } catch {
      logger.warn({ capabilityId: cap.id }, 'capability config is not valid JSON, skipping');
      state[cap.id] = { toolCount: 0, lastError: 'invalid JSON in config' };
      continue;
    }

    if (!config.enabled) {
      state[cap.id] = { toolCount: 0 };
      continue;
    }

    const toolsBefore = Object.keys(tools).length;
    try {
      await cap.registerTools(config, configStore, logger, tools);
      const toolCount = Object.keys(tools).length - toolsBefore;
      state[cap.id] = { toolCount };
      loadedCapabilityIds.push(cap.id);
    } catch (err) {
      logger.warn({ capabilityId: cap.id, err: (err as Error).message }, `${cap.displayName} tools disabled`);
      state[cap.id] = { toolCount: 0, lastError: (err as Error).message };
    }

    // Start findWork poller if configured
    if (
      config.findWork?.enabled &&
      cap.startFindWork &&
      onNewWork
    ) {
      try {
        const stop = cap.startFindWork(config, logger, onNewWork);
        stopFns.push(stop);
      } catch (err) {
        logger.warn({ capabilityId: cap.id, err: (err as Error).message }, `${cap.displayName} findWork failed to start`);
      }
    }
  }

  // ── Preferences tools (always available) ─────────────────────────────────
  try {
    const prefDbPath = dbPath ?? './tino.db';
    const prefStore = createPreferencesStore({ dbPath: prefDbPath });
    tools['set_preference'] = setPreferenceTool(prefStore, allowedUserId);
    tools['get_preferences'] = getPreferencesTool(prefStore, allowedUserId);
    logger.info('preferences tools enabled');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'preferences tools disabled');
  }

  // ── Task tools (available when taskStore is provided) ────────────────────
  if (taskStore) {
    try {
      tools['schedule_task'] = scheduleTaskTool(taskStore, allowedUserId);
      tools['list_tasks'] = listTasksTool(taskStore, allowedUserId);
      tools['cancel_task'] = cancelTaskTool(taskStore);
      logger.info('task tools enabled');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'task tools disabled');
    }
  }

  return {
    tools,
    capabilityIds: loadedCapabilityIds,
    stopAll() {
      for (const stop of stopFns) {
        try { stop(); } catch { /* ignore */ }
      }
    },
    getState() {
      return { ...state };
    },
  };
}
