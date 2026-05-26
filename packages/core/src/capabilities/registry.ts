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
import type { ToolSet } from "ai";
import type { ConfigStore } from "../persistence/config.js";
import type { PreferencesStore } from "../persistence/preferences.js";
import { createPreferencesStore } from "../persistence/preferences.js";
import type { TaskStore } from "../persistence/tasks.js";
import type { UserCapabilityStore } from "../persistence/user-capabilities.js";
import type { AppLogger } from "../slack/app.js";
import { updateDiscoveryTool } from "../tools/discovery.js";
import { getPreferencesTool, setPreferenceTool } from "../tools/preferences.js";
import { cancelTaskTool, listTasksTool, scheduleTaskTool } from "../tools/tasks.js";
import { MCPPool } from "../mcp/pool.js";
import { setMCPPool } from "./mcp.js";
import { ALL_CAPABILITIES } from "./all.js";
import type { CapabilityConfig, CapabilityRegistry, CapabilityRuntimeState, SharedCapability, PrivateCapability } from "./types.js";
import { SYSTEM_USER_ID } from "../identity/types.js";

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
   * Per-user capability store for encrypted credentials (wave 2).
   * When provided, buildPrivateTools checks this store before falling back
   * to the global configStore for backward compatibility.
   */
  userCapabilities?: UserCapabilityStore;
  /**
   * Called when a findWork poller discovers new work.
   * Receives a summary string describing the work item.
   */
  onNewWork?: (summary: string) => Promise<void>;
}

/**
 * Walk shared capability modules only, read their config from `configStore`,
 * and register tools / start findWork pollers. Mutates `tools`, `state`,
 * and `stopFns` in place.
 *
 * Reused by `initCapabilityRegistry` (initial load) and `reload()` (wave 3.2).
 * Private capabilities are materialized on-demand via `buildPrivateTools`.
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
    // Skip private capabilities; they're materialized per-user via buildPrivateTools
    if (cap.scope === "private") {
      continue;
    }

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
      logger.warn({ capabilityId: cap.id }, "capability config is not valid JSON, skipping");
      state[cap.id] = { toolCount: 0, lastError: "invalid JSON in config" };
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

    // Start findWork poller if configured (shared capabilities only)
    if (config.findWork?.enabled && cap.startFindWork && onNewWork) {
      try {
        const stop = cap.startFindWork(config, logger, onNewWork);
        stopFns.push(stop);
      } catch (err) {
        logger.warn(
          { capabilityId: cap.id, err: (err as Error).message },
          `${cap.displayName} findWork failed to start`,
        );
      }
    }
  }
}

/**
 * Initialize the capability registry.
 *
 * Reads each `capability.<id>` key from the config store. For enabled
 * shared capabilities with credentials, calls registerTools. For capabilities
 * with findWork.enabled=true, starts the poller. Private capabilities are
 * materialized on-demand via `buildPrivateTools()` per agent run.
 */
export async function initCapabilityRegistry(opts: RegistryOptions): Promise<CapabilityRegistry> {
  const { configStore, logger, allowedUserId, dbPath, preferencesStore, taskStore, userCapabilities, onNewWork } = opts;
  // Mutable buckets — the registry exposes `sharedTools` directly so callers can
  // share a stable reference across reloads (`reload()` mutates this in place).
  const sharedTools: ToolSet = {};
  let stopFns: Array<() => void | Promise<void>> = [];
  let state: Record<string, CapabilityRuntimeState> = {};
  let loadedCapabilityIds: string[] = [];

  // ── Shared capability tools ───────────────────────────────────────────────
  await loadCapabilityTools({
    configStore,
    logger,
    onNewWork,
    tools: sharedTools,
    state,
    stopFns,
    loadedCapabilityIds,
  });

  // ── Per-user tool stores ──────────────────────────────────────────────────
  // Preferences and task tools are bound to the calling user's tino-UUID in
  // buildPrivateTools below. We resolve the stores once here so
  // buildPrivateTools can close over them without re-constructing each call.
  let prefStore: PreferencesStore | null = null;
  try {
    prefStore = preferencesStore ?? createPreferencesStore({ dbPath: dbPath ?? "./tino.db" });
    logger.info("preferences tools enabled");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "preferences tools disabled");
  }

  // ── MCP Pool ──────────────────────────────────────────────────────────────
  // Create pool once per registry instance and initialize MCP capability with it.
  const pool = new MCPPool({ logger });
  setMCPPool(pool);
  stopFns.push(async () => {
    await pool.killAll();
  });

  /**
   * Build tools for a specific user from private capabilities.
   * Returns empty toolset for SYSTEM_USER_ID; otherwise walks private
   * capabilities and reads their config in this order:
   *   1. Wave 2+: UserCapabilityStore if available (encrypted per-user)
   *   2. Wave 1: Global `capability.<id>` blob for backward compatibility
   *
   * Non-null results are merged. Per-capability errors are logged and skipped.
   */
  async function buildPrivateTools(tinoUserId: string): Promise<ToolSet> {
    if (tinoUserId === SYSTEM_USER_ID) {
      return {};
    }

    const privateTools: ToolSet = {};

    // Per-user preference tools (bound to this user's tino-UUID)
    if (prefStore) {
      privateTools.set_preference = setPreferenceTool(prefStore, tinoUserId);
      privateTools.get_preferences = getPreferencesTool(prefStore, tinoUserId);
    }

    // Per-user task tools
    if (taskStore) {
      privateTools.schedule_task = scheduleTaskTool(taskStore, tinoUserId);
      privateTools.list_tasks = listTasksTool(taskStore, tinoUserId);
      privateTools.cancel_task = cancelTaskTool(taskStore);
    }

    // Discovery update tool — lets the agent patch the user's discovery profile
    privateTools.update_discovery = updateDiscoveryTool(configStore, tinoUserId);
    for (const cap of ALL_CAPABILITIES) {
      if (cap.scope !== "private") {
        continue;
      }

      let config: CapabilityConfig | null = null;

      // Wave 2: Check UserCapabilityStore first (encrypted per-user)
      if (userCapabilities) {
        try {
          config = await userCapabilities.get(tinoUserId, cap.id);
        } catch (err) {
          logger.warn(
            { capabilityId: cap.id, tinoUserId, err: (err as Error).message },
            "failed to read from user capability store, falling back to global config",
          );
          config = null;
        }
      }

      // Wave 1 fallback: Check global config if not found in user store
      if (!config) {
        const raw = await configStore.get(`capability.${cap.id}`);
        if (raw !== null) {
          try {
            config = JSON.parse(raw) as CapabilityConfig;
          } catch {
            logger.warn({ capabilityId: cap.id, tinoUserId }, "capability config is not valid JSON, skipping");
            continue;
          }
          if (!config.enabled) {
            config = null;
          }
        }
      }

      try {
        const tools = await cap.buildToolsForUser(tinoUserId, config, configStore, logger, userCapabilities);
        if (tools !== null) {
          Object.assign(privateTools, tools);
        }
      } catch (err) {
        logger.warn(
          { capabilityId: cap.id, tinoUserId, err: (err as Error).message },
          `${cap.displayName} tools failed to build`,
        );
      }
    }

    return privateTools;
  }

  /**
   * Get the list of active capability IDs for the given user.
   * For SYSTEM_USER_ID, returns shared ids only. Otherwise returns
   * shared ids + private ids whose buildToolsForUser returned non-null.
   */
  async function getActiveCapabilities(tinoUserId: string): Promise<string[]> {
    const active = [...loadedCapabilityIds];

    if (tinoUserId === SYSTEM_USER_ID) {
      return active;
    }

    // Walk private capabilities and add those that are connected
    for (const cap of ALL_CAPABILITIES) {
      if (cap.scope !== "private") {
        continue;
      }

      let config: CapabilityConfig | null = null;

      // Wave 2: Check UserCapabilityStore first
      if (userCapabilities) {
        try {
          config = await userCapabilities.get(tinoUserId, cap.id);
        } catch {
          config = null;
        }
      }

      // Wave 1 fallback: Check global config
      if (!config) {
        const raw = await configStore.get(`capability.${cap.id}`);
        if (raw !== null) {
          try {
            config = JSON.parse(raw) as CapabilityConfig;
          } catch {
            continue;
          }
          if (!config.enabled) {
            config = null;
          }
        }
      }

      try {
        const tools = await cap.buildToolsForUser(tinoUserId, config, configStore, logger, userCapabilities);
        if (tools !== null) {
          active.push(cap.id);
        }
      } catch {
        // Silently skip on error
      }
    }

    return active.sort();
  }

  return {
    sharedTools,
    buildPrivateTools,
    getActiveCapabilities,
    get capabilityIds() {
      return loadedCapabilityIds;
    },
    async stopAll() {
      for (const stop of stopFns) {
        try {
          await stop();
        } catch {
          /* ignore */
        }
      }
    },
    getState() {
      return { ...state };
    },

    /**
     * Wave 3.2 — re-read every shared `capability.<id>` from the config store
     * and atomically swap the capability portion of the toolset.
     *
     * Mechanism:
     *   1. Stop existing findWork pollers from the previous load (so we don't
     *      end up with two pollers per capability).
     *   2. Compute the set of capability tool keys currently in `sharedTools` (the
     *      preferences/tasks tools are NOT capability tools — they stay).
     *   3. Delete those keys IN PLACE on the same `sharedTools` reference.
     *   4. Re-run the capability loop, populating `sharedTools` again.
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
        const NON_CAPABILITY_TOOLS = new Set<string>();
        const before = Object.keys(sharedTools).filter((k) => !NON_CAPABILITY_TOOLS.has(k));

        // Stop existing pollers BEFORE clearing — otherwise stale callbacks
        // could fire during the swap window.
        for (const stop of stopFns) {
          try {
            await stop();
          } catch {
            /* ignore */
          }
        }

        // Atomic-from-the-caller's-perspective swap: delete then repopulate.
        // The `sharedTools` reference itself never changes; consumers holding it
        // see the new contents.
        for (const k of before) delete sharedTools[k];

        // Reset the bookkeeping containers to fresh ones; the registry's
        // `stopAll` / `getState` / `capabilityIds` getters bind to the new
        // values via the closure.
        stopFns = [];
        state = {};
        loadedCapabilityIds = [];

        await loadCapabilityTools({
          configStore,
          logger,
          onNewWork,
          tools: sharedTools,
          state,
          stopFns,
          loadedCapabilityIds,
        });

        const after = Object.keys(sharedTools).filter((k) => !NON_CAPABILITY_TOOLS.has(k));
        // Operators grep for this exact log line to diff what changed.
        logger.info({ before, after }, "capabilities reloaded");

        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}
