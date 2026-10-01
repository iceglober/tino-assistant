/**
 * Helpers around the SETTINGS catalogue from @tino/contracts: which fields a
 * page shows, and turning a form draft into the smallest SettingsUpdate.
 */
import { SETTINGS, type SettingGroup, type SettingSpec, type SettingsUpdate, type SettingsView } from "@tino/contracts";

export const specsFor = (group: SettingGroup): SettingSpec[] => SETTINGS.filter((s) => s.group === group);

export const spec = (key: string): SettingSpec | undefined => SETTINGS.find((s) => s.key === key);

/** The model fields that belong to one provider (e.g. "openai" → openai.*). */
export const providerSpecs = (provider: string): SettingSpec[] =>
  SETTINGS.filter((s) => s.group === "model" && s.key.startsWith(`${provider}.`));

/** A saved non-secret value as a form string ("" when unset). */
export function savedValue(view: SettingsView, key: string): string {
  const v = view.values[key];
  return v === undefined || v === null ? "" : String(v);
}

/**
 * A form's draft. Non-secret keys hold the current text. Secret keys are
 * absent while untouched, a string when replaced, and null when cleared.
 */
export type SettingsDraft = Record<string, string | null>;

/** The changes between what's saved and the draft, ready to PUT. Null deletes. */
export function diffSettings(view: SettingsView, draft: SettingsDraft, keys: string[]): SettingsUpdate {
  const values: SettingsUpdate["values"] = {};
  for (const key of keys) {
    if (!(key in draft)) continue;
    const s = spec(key);
    const next = draft[key];
    if (s?.secret) {
      if (next === null) {
        if (view.secrets[key]) values[key] = null;
      } else if (typeof next === "string" && next.trim()) {
        values[key] = next.trim();
      }
      continue;
    }
    const before = savedValue(view, key);
    const after = (next ?? "").trim();
    if (after === before) continue;
    if (!after) {
      if (before) values[key] = null;
      continue;
    }
    values[key] = s?.kind === "number" && Number.isFinite(Number(after)) ? Number(after) : after;
  }
  return { values };
}

export const hasChanges = (update: SettingsUpdate): boolean => Object.keys(update.values).length > 0;

/** Validate a number setting's text; returns an error sentence or null. */
export function numberError(key: string, raw: string): string | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "enter a number.";
  if (key === "kb.recencyWeight" && (n < 0 || n > 1)) return "use a value between 0 and 1.";
  if (key === "kb.recencyTauDays" && n <= 0) return "use a positive number of days.";
  return null;
}
