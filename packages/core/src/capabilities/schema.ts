/**
 * Schema helpers — bridge between the on-disk `CapabilityConfig` blob and the
 * console-friendly `{ id, fields, enabled }` shape.
 *
 * The console renders each capability card from `fieldSchema` (declared on each
 * `CapabilityModule`); the server uses these helpers to:
 *   - GET: hydrate fields with values pulled from the stored blob
 *   - PUT: walk fields back into a `CapabilityConfig` blob the registry accepts
 *
 * Targets are dotted paths into the blob:
 *   - `credentials.<name>` → string
 *   - `settings.<name>`    → string OR string[] (when `kind: 'string[]'`)
 */

import { ALL_CAPABILITIES } from "./all.js";
import type { CapabilityConfig, CapabilityModule, CapField } from "./types.js";

/** Public-facing shape returned by GET /api/capabilities. */
export interface CapabilityView {
  id: string;
  displayName: string;
  enabled: boolean;
  fields: CapField[];
  findWork?: CapabilityConfig["findWork"];
  updatedAt?: number;
}

/**
 * Parse a `target` string like "credentials.token" into its segments.
 * Returns null if malformed (defensive — schemas should never produce these).
 */
function parseTarget(target: string): { section: "credentials" | "settings"; name: string } | null {
  const dot = target.indexOf(".");
  if (dot < 1) return null;
  const section = target.slice(0, dot);
  const name = target.slice(dot + 1);
  if (section !== "credentials" && section !== "settings") return null;
  if (!name) return null;
  return { section, name };
}

/** Read the value at `target` from a stored blob and stringify it for the input. */
function readField(config: CapabilityConfig, field: CapField): string {
  const t = parseTarget(field.target);
  if (!t) return "";
  const bag = t.section === "credentials" ? config.credentials : config.settings;
  const raw = bag?.[t.name];
  if (raw === undefined || raw === null) return "";
  if (field.kind === "string[]") {
    return Array.isArray(raw) ? raw.join(", ") : String(raw);
  }
  return typeof raw === "string" ? raw : String(raw);
}

/**
 * Build the console view for a capability — merges its declared `fieldSchema`
 * with any stored blob to fill in `value`.
 */
export function buildCapabilityView(
  cap: CapabilityModule,
  stored: CapabilityConfig | null,
  updatedAt: number | undefined,
): CapabilityView {
  const schema = cap.fieldSchema ?? [];
  const config: CapabilityConfig = stored ?? {
    enabled: false,
    credentials: {},
    settings: {},
  };
  const fields: CapField[] = schema.map((f) => ({
    ...f,
    value: readField(config, f),
  }));
  return {
    id: cap.id,
    displayName: cap.displayName,
    enabled: !!config.enabled,
    fields,
    findWork: config.findWork,
    updatedAt,
  };
}

/** Coerce a string into the target shape (string vs string[]). */
function coerce(field: CapField, raw: unknown): string | string[] {
  const s = typeof raw === "string" ? raw : String(raw ?? "");
  if (field.kind === "string[]") {
    return s
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return s;
}

/**
 * Reconstruct a `CapabilityConfig` from the console-facing payload.
 *
 * Accepts either:
 *   - the new `{ enabled, fields: [{ target, value }] }` shape (preferred), or
 *   - a legacy raw `{ enabled, credentials, settings }` blob (passes through)
 *
 * Unknown fields on a legacy blob are preserved so we never silently drop
 * keys the schema doesn't know about (e.g. `findWork`, `awsProfile`).
 */
export function buildConfigFromPayload(
  cap: CapabilityModule,
  payload: unknown,
  existing: CapabilityConfig | null,
): CapabilityConfig {
  const base: CapabilityConfig = existing ?? {
    enabled: false,
    credentials: {},
    settings: {},
  };

  // Start with a defensive deep-ish clone of base so we don't mutate the input.
  const next: CapabilityConfig = {
    enabled: base.enabled,
    credentials: { ...base.credentials },
    settings: { ...base.settings },
    ...(base.findWork ? { findWork: { ...base.findWork } } : {}),
  };

  if (!payload || typeof payload !== "object") {
    return next;
  }
  const obj = payload as Record<string, unknown>;

  if (typeof obj.enabled === "boolean") {
    next.enabled = obj.enabled;
  }
  if (obj.findWork && typeof obj.findWork === "object") {
    next.findWork = obj.findWork as CapabilityConfig["findWork"];
  }

  // Preferred: schema-driven `fields` array.
  if (Array.isArray(obj.fields)) {
    const schema = cap.fieldSchema ?? [];
    for (const submitted of obj.fields as Array<Record<string, unknown>>) {
      const key = typeof submitted.key === "string" ? (submitted.key as string) : null;
      if (!key) continue;
      const def = schema.find((f) => f.key === key);
      if (!def) continue;
      const target = parseTarget(def.target);
      if (!target) continue;
      const coerced = coerce(def, submitted.value);
      const bag = target.section === "credentials" ? next.credentials : next.settings;
      // Drop empty strings/arrays so unset fields don't pollute the blob.
      if ((typeof coerced === "string" && coerced.length === 0) || (Array.isArray(coerced) && coerced.length === 0)) {
        delete bag[target.name];
      } else {
        bag[target.name] = coerced as string;
      }
    }
    return next;
  }

  // Legacy shape: raw `credentials` / `settings` blob — pass through.
  if (obj.credentials && typeof obj.credentials === "object") {
    next.credentials = { ...(obj.credentials as Record<string, string>) };
  }
  if (obj.settings && typeof obj.settings === "object") {
    next.settings = { ...(obj.settings as Record<string, unknown>) };
  }
  return next;
}

/** Look up a capability module by id (returns null for unknown ids). */
export function findCapability(id: string): CapabilityModule | null {
  return ALL_CAPABILITIES.find((c) => c.id === id) ?? null;
}
