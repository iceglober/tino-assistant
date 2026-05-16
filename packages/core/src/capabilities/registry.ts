/**
 * Capability registry — loads capabilities from the config store, registers
 * tools, and starts findWork pollers.
 *
 * Also registers the non-capability tools (preferences, tasks) that are
 * always available regardless of capability config.
 *
 * Wave 3.2 — exposes `reload()` so the console can swap the active
 * toolset without restarting the process. The reload mutates the existing
 * `tools` reference in place so the agent loop and scheduler (which read
 * `registry.tools` per-call but might capture the reference at startup)
 * see the new toolset immediately.
 */
import type { ToolSet } from 'ai';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import type { TaskStore } from '../persistence/tasks.js';
import type { PreferencesStore } from '../persistence/preferences.js';
import type { CapabilityConfig, CapabilityRegistry, CapabilityRuntimeState } from './types.js';
import { createPreferencesStore } from '../persistence/preferences.js';
import { setPreferenceTool, getPreferencesTool } from '../tools/preferences.js';
import { scheduleTaskTool, listTasksTool, cancelTaskTool } from '../tools/tasks.js';
import { ALL_CAPABILITIES } from './all.js';

export interface RegistryOptions {
  configStore: ConfigStore;
  logger: AppLogger;
  /** ALLOWED_SLACK_USER_ID — needed for preferences and task tools. */
  allowedUserId: string;
  /**
   * DB path for the SQLite preferences store. Used only when `preferencesStore`
   * is NOT injected (local dev with SQLite persistence). Production (DynamoDB)
   * passes `preferencesStore` directly and this is ignored.
   */
  dbPath?: string;
  /**
   * Pre-built preferences store from the persistence factory. When provided,
   * the registry uses it instead of constructing a new SQLite store.
   *
   * In production (PERSISTENCE_ADAPTER=dynamodb) this MUST be passed —
   * otherwise the registry tries to open a SQLite file on the read-only
   * root filesystem and the preferences tools log "disabled". (gap #6)
   */
  preferencesStore?: PreferencesStore;
  /** Task store for schedule_task / list_tasks / cancel_task tools. */
  taskStore?: TaskStore;
  /**
   * Called when a findWork poller discovers new work.
   * Receives a summary string describing the work item.
   */
  onNewWork?: (summary: string) => Promise<void>;
}

/**
 * Walk every capability module, read its config from `configStore`, and
 * register tools / start findWork pollers. Mutates `tools`, `state`, and
 * `stopFns` in place.
 *
 * Reused by `initCapabilityRegistry` (initial load) and `reload()` (wave 3.2).
 */
async function loadCapabilityTools(opts: {
  configStore: ConfigStore;
  logger: AppLogger;
  onNewWork?: (summary: string) => Promise<void>;
  tools: ToolSet;
  state: Record<string, CapabilityRuntimeState>;
  stopFns: Array<() => void>;
  loadedCapabilityIds: string[];
}): Promise<void> {
  const { configStore, logger, onNewWork, tools, state, stopFns, loadedCapabilityIds } = opts;

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
}

/**
 * Initialize the capability registry.
 *
 * Reads each `capability.<id>` key from the config store. For enabled
 * capabilities with credentials, calls registerTools. For capabilities with
 * findWork.enabled=true, starts the poller.
 */
export async function initCapabilityRegistry(opts: RegistryOptions): Promise<CapabilityRegistry> {
  const { configStore, logger, allowedUserId, dbPath, preferencesStore, taskStore, onNewWork } = opts;
  // Mutable buckets — the registry exposes `tools` directly so callers can
  // share a stable reference across reloads (`reload()` mutates this in place).
  const tools: ToolSet = {};
  let stopFns: Array<() => void> = [];
  let state: Record<string, CapabilityRuntimeState> = {};
  let loadedCapabilityIds: string[] = [];

  // ── Capability tools ──────────────────────────────────────────────────────
  await loadCapabilityTools({
    configStore, logger, onNewWork,
    tools, state, stopFns, loadedCapabilityIds,
  });

  // ── Preferences tools (always available) ─────────────────────────────────
  // Prefer the injected store (mirrors the taskStore injection pattern below).
  // Fall back to constructing a SQLite store only when no store was injected,
  // i.e. local-dev callers that haven't been threaded through `createPersistence`.
  try {
    const prefStore =
      preferencesStore ??
      createPreferencesStore({ dbPath: dbPath ?? './tino.db' });
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
    get capabilityIds() { return loadedCapabilityIds; },
    stopAll() {
      for (const stop of stopFns) {
        try { stop(); } catch { /* ignore */ }
      }
    },
    getState() {
      return { ...state };
    },

    /**
     * Wave 3.2 — re-read every `capability.<id>` from the config store and
     * atomically swap the capability portion of the toolset.
     *
     * Mechanism:
     *   1. Stop existing findWork pollers from the previous load (so we don't
     *      end up with two pollers per capability).
     *   2. Compute the set of capability tool keys currently in `tools` (the
     *      preferences/tasks tools are NOT capability tools — they stay).
     *   3. Delete those keys IN PLACE on the same `tools` reference.
     *   4. Re-run the capability loop, populating `tools` again.
     *   5. Replace `state`, `stopFns`, `loadedCapabilityIds` with fresh values.
     *
     * Errors from a single capability don't roll back the whole reload —
     * the per-capability try/catch in `loadCapabilityTools` handles those
     * the same way as the initial load. Only an error in the surrounding
     * machinery (config store read failure) propagates out.
     */
    async reload(): Promise<{ ok: boolean; error?: string }> {
      try {
        // Snapshot which tool keys came from capabilities (not preferences/tasks)
        // so we know which ones to clear. We compute by exclusion: anything that
        // isn't a known non-capability tool is a capability tool.
        const NON_CAPABILITY_TOOLS = new Set([
          'set_preference', 'get_preferences',
          'schedule_task', 'list_tasks', 'cancel_task',
        ]);
        const before = Object.keys(tools).filter((k) => !NON_CAPABILITY_TOOLS.has(k));

        // Stop existing pollers BEFORE clearing — otherwise stale callbacks
        // could fire during the swap window.
        for (const stop of stopFns) {
          try { stop(); } catch { /* ignore */ }
        }

        // Atomic-from-the-caller's-perspective swap: delete then repopulate.
        // The `tools` reference itself never changes; consumers holding it
        // see the new contents.
        for (const k of before) delete tools[k];

        // Reset the bookkeeping containers to fresh ones; the registry's
        // `stopAll` / `getState` / `capabilityIds` getters bind to the new
        // values via the closure.
        stopFns = [];
        state = {};
        loadedCapabilityIds = [];

        await loadCapabilityTools({
          configStore, logger, onNewWork,
          tools, state, stopFns, loadedCapabilityIds,
        });

        const after = Object.keys(tools).filter((k) => !NON_CAPABILITY_TOOLS.has(k));
        // Operators grep for this exact log line to diff what changed.
        logger.info({ before, after }, 'capabilities reloaded');

        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}
