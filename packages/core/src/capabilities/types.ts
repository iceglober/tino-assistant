/**
 * Core types for the capability-as-config-unit architecture.
 *
 * Each capability (github, linear, slack, gmail, calendar, cloudwatch) is a
 * self-contained unit with credentials, settings, and an optional findWork
 * scanner. Capabilities are stored in the config table under `capability.<id>`.
 */
import type { ToolSet } from 'ai';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';

/** Stored in the config table as a JSON blob under `capability.<id>`. */
export interface CapabilityConfig {
  enabled: boolean;
  credentials: Record<string, string>;   // tokens, API keys
  settings: Record<string, unknown>;     // allowlists, defaults, tool-specific config
  findWork?: {
    enabled: boolean;
    intervalMinutes: number;
    lastScanAt?: number; // epoch ms
  };
}

/** Runtime state tracked per capability (not persisted). */
export interface CapabilityRuntimeState {
  toolCount: number;
  lastFindWorkScanAt?: number;
  lastError?: string;
}

/** What a capability module must export. */
export interface CapabilityModule {
  /** Stable identifier, e.g. "github", "linear". */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /**
   * Register tools into the toolset. Called only when the capability is enabled
   * and credentials are present. Should throw if credentials are missing/invalid.
   */
  registerTools(
    config: CapabilityConfig,
    configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void>;
  /**
   * Start the findWork poller. Called only when capability.findWork.enabled is true.
   * Returns a stop function.
   */
  startFindWork?(
    config: CapabilityConfig,
    logger: AppLogger,
    onNewWork: (summary: string) => Promise<void>,
  ): () => void;
}

/** The live registry returned by initCapabilityRegistry. */
export interface CapabilityRegistry {
  /** All registered tools, ready for runAgent. */
  tools: ToolSet;
  /** Stop all findWork pollers. */
  stopAll(): void;
  /** Per-capability runtime state for the health endpoint. */
  getState(): Record<string, CapabilityRuntimeState>;
  /** Ordered list of capability IDs that were loaded. */
  capabilityIds: string[];
}
