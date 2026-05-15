import { useEffect, useState } from 'react';
import { getConfig, type ConfigEntry, UnauthorizedError } from '../lib/api.js';

export interface UseConfigResult {
  entries: ConfigEntry[];
  loading: boolean;
  error: string | null;
  unauthorized: boolean;
  refresh: () => Promise<void>;
}

/**
 * Subscribe to /api/config. Mirror of the inline `getConfig` helper at
 * `html.ts:1553-1558` plus the surrounding loading/error UI handling.
 */
export function useConfig(): UseConfigResult {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
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
    void refresh();
  }, []);

  return { entries, loading, error, unauthorized, refresh };
}
