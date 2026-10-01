import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * Read one-shot query params an OAuth round-trip comes back with (e.g.
 * ?installed=1, ?error=team_taken), keep them in state, and strip them from
 * the URL so a reload doesn't repeat the message.
 */
export function useReturnParams(keys: string[]) {
  const [params, setParams] = useSearchParams();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const keyList = keys.join("|");

  useEffect(() => {
    const ks = keyList.split("|");
    const found: Record<string, string> = {};
    for (const k of ks) {
      const v = params.get(k);
      if (v !== null) found[k] = v;
    }
    if (!Object.keys(found).length) return;
    setValues(found);
    setParams(
      (p) => {
        for (const k of ks) p.delete(k);
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [params, setParams, keyList]);

  return [values, () => setValues(null)] as const;
}
