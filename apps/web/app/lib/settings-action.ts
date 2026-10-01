/**
 * The one clientAction every settings page shares: save the changed keys,
 * then ask the server to rebuild the org's runtime so they take effect.
 */
import type { SettingsUpdate } from "@tino/contracts";
import { orgApi } from "./api";
import { errorMessage } from "./format";
import { invalidateOverview } from "./session";

export type SettingsIntent = { intent: "save"; update: SettingsUpdate; label?: string } | { intent: "rebuild" };

export type SettingsActionResult =
  | { ok: true; intent: "save" | "rebuild"; message: string }
  | { ok: false; intent: "save" | "rebuild"; error: string; saved?: boolean };

export async function runSettingsAction(slug: string, request: Request): Promise<SettingsActionResult> {
  const body = (await request.json()) as SettingsIntent;
  const api = orgApi(slug);
  if (body.intent === "rebuild") {
    try {
      await api.rebuildKb();
      invalidateOverview(slug);
      return {
        ok: true,
        intent: "rebuild",
        message: "knowledge base wiped — tino starts reading again on the next cycle",
      };
    } catch (err) {
      return { ok: false, intent: "rebuild", error: errorMessage(err) };
    }
  }

  try {
    await api.saveSettings(body.update);
  } catch (err) {
    return { ok: false, intent: "save", error: errorMessage(err) };
  }
  invalidateOverview(slug);
  try {
    const applied = await api.apply();
    if (!applied.ok) {
      return {
        ok: false,
        intent: "save",
        saved: true,
        error: `saved, but tino couldn't start with these settings: ${applied.error ?? "unknown error"}`,
      };
    }
  } catch (err) {
    return { ok: false, intent: "save", saved: true, error: `saved, but reloading failed: ${errorMessage(err)}` };
  }
  return { ok: true, intent: "save", message: `${body.label ?? "settings"} saved — tino picked them up` };
}
