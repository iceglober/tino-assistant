import { useEffect, useRef } from "react";
import type { FetcherWithComponents } from "react-router";
import { useToast } from "../components/ui/Toast";

/** The shape clientActions in this app return. */
export type ActionResult = { ok: true; message?: string; intent?: string } | { ok: false; error: string; intent?: string };

/**
 * Toast the outcome of a fetcher submission once it settles: the action's
 * own message on success, its error sentence on failure.
 */
export function useFetcherToast(fetcher: FetcherWithComponents<unknown>, onSettled?: (r: ActionResult) => void) {
  const toast = useToast();
  const prev = useRef(fetcher.state);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    const was = prev.current;
    prev.current = fetcher.state;
    if (was === "idle" || fetcher.state !== "idle") return;
    const r = fetcher.data as ActionResult | undefined;
    if (!r || typeof r !== "object" || !("ok" in r)) return;
    if (r.ok) {
      if (r.message) toast.ok(r.message);
    } else toast.err(r.error);
    settledRef.current?.(r);
  }, [fetcher.state, fetcher.data, toast]);
}
