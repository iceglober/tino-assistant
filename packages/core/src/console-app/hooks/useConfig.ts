import { useEffect, useState } from "react";
import { type ConfigEntry, getConfig, UnauthorizedError } from "../lib/api.js";

export interface UseConfigResult {
  entries: ConfigEntry[];
  loading: boolean;
  error: string | null;
  unauthorized: boolean;
  refresh: () => Promise<void>;
}

/**
 * Subscribe to /api/config.
 *
 * Pass `{ lazy: true }` to skip the initial fetch on mount — the caller
 * is responsible for calling `refresh()` when the data is actually needed
 * (e.g. when an accordion opens).
 */
export function useConfig(opts?: { lazy?: boolean }): UseConfigResult {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(!opts?.lazy);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await getConfig();
      setEntries(data);
      setUnauthorized(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setUnauthorized(true);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!opts?.lazy) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount (or never if lazy)
  }, []);

  return { entries, loading, error, unauthorized, refresh };
}
