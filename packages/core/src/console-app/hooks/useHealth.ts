import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse } from '../lib/api.js';

export interface UseHealthResult {
  health: HealthResponse | null;
  error: string | null;
}

/**
 * Polls /api/health every 30s. Mirror of the inline `loadHealth` at
 * `html.ts:1832-1864`.
 */
export function useHealth(intervalMs: number = 30_000): UseHealthResult {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const data = await getHealth();
        if (alive) {
          setHealth(data);
          setError(null);
        }
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    return (): void => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { health, error };
}
