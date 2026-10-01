import type { SettingsView } from "@tino/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { jsonBody } from "../../lib/json-body";
import { diffSettings, hasChanges, type SettingsDraft, savedValue, spec } from "../../lib/settings";
import type { SettingsActionResult } from "../../lib/settings-action";
import { useToast } from "../ui/Toast";

/**
 * Form state for a group of catalogue keys: the draft, what changed, and a
 * save that PUTs only the changes and applies them.
 */
export function useSettingsForm(view: SettingsView, keys: string[], label: string) {
  const keyList = keys.join("|");
  const initial = useMemo(() => {
    const d: SettingsDraft = {};
    for (const k of keyList.split("|")) if (!spec(k)?.secret) d[k] = savedValue(view, k);
    return d;
  }, [view, keyList]);

  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const fetcher = useFetcher<SettingsActionResult>();
  const toast = useToast();
  const [applyError, setApplyError] = useState<string | null>(null);
  const prev = useRef(fetcher.state);

  // A fresh view (after save + revalidate) resets the draft: secrets go back to "saved".
  useEffect(() => setDraft(initial), [initial]);

  useEffect(() => {
    const was = prev.current;
    prev.current = fetcher.state;
    if (was === "idle" || fetcher.state !== "idle" || !fetcher.data) return;
    const r = fetcher.data;
    if (r.ok) {
      setApplyError(null);
      toast.ok(r.message);
    } else {
      setApplyError(r.error);
      toast.err(r.saved ? "saved, with a problem — see the page" : r.error);
    }
  }, [fetcher.state, fetcher.data, toast]);

  const update = diffSettings(view, draft, keys);
  const dirty = hasChanges(update);

  const set = (key: string, v: string | null | undefined) =>
    setDraft((d) => {
      const next = { ...d };
      if (v === undefined) delete next[key];
      else next[key] = v;
      return next;
    });

  const save = (extra?: SettingsDraft) => {
    const u = extra ? diffSettings(view, { ...draft, ...extra }, keys) : update;
    if (!hasChanges(u)) return;
    fetcher.submit(jsonBody({ intent: "save", update: u, label }), { method: "post", encType: "application/json" });
  };

  return {
    draft,
    set,
    dirty,
    save,
    reset: () => setDraft(initial),
    saving: fetcher.state !== "idle",
    applyError,
    value: (k: string) => draft[k],
    isSet: (k: string) => !!view.secrets[k],
  };
}
