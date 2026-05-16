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

/**
 * Console-side schema describing one configurable input on a capability card.
 *
 * `target` is a dotted path into the stored `CapabilityConfig`:
 *   - `credentials.<name>` — string credentials (tokens, secrets)
 *   - `settings.<name>`    — non-secret settings (allowlists, defaults)
 *
 * `kind` controls input rendering and how the value is round-tripped:
 *   - `string` (default) — plain text input; stored as a string
 *   - `string[]`         — comma/newline separated input; stored as `string[]`
 *
 * The console fills `value` server-side from the stored blob before responding
 * to GET /api/capabilities; on PUT it walks each `target` to reconstruct the
 * `CapabilityConfig` shape that the registry expects.
 */
export interface CapField {
  key: string;
  label: string;
  target: string;          // e.g. "credentials.token", "settings.repos"
  kind?: 'string' | 'string[]';
  secret?: boolean;
  placeholder?: string;
  /** Filled in by the GET handler from the stored blob; never declared by modules. */
  value?: string;
}

/** What a capability module must export. */
export interface CapabilityModule {
  /** Stable identifier, e.g. "github", "linear". */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /**
   * Console-side input schema. The server uses this to render the card with
   * inputs even when no `capability.<id>` blob is stored yet, and to reconstruct
   * a valid `CapabilityConfig` on save.
   */
  fieldSchema?: CapField[];
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
  /**
   * Wave 3.2 — re-read every `capability.<id>` entry from the config store
   * and atomically swap the toolset. Mutates the existing `tools` reference
   * in place (deletes all keys, then re-populates) so external holders of
   * the same `tools` object see the new toolset without a re-import.
   *
   * Per-capability errors are caught and logged; the reload as a whole
   * still resolves `{ ok: true }` unless the loop itself throws (e.g. the
   * config store is unreachable). findWork pollers from the previous load
   * are stopped before new ones start.
   */
  reload(): Promise<{ ok: boolean; error?: string }>;
}
