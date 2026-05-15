import { useEffect, useState, type JSX } from 'react';
import type { HealthResponse } from '../lib/api.js';

/**
 * Health footer — uptime + tool count.
 *
 * Mirror: `html.ts:1424-1428` + the `loadHealth` body at `html.ts:1832-1864`.
 */
export function HealthFooter({ health }: { health: HealthResponse | null }): JSX.Element {
  const [uptimeText, setUptimeText] = useState('');

  useEffect(() => {
    if (!health || health.uptime == null) {
      setUptimeText('');
      return;
    }
    const update = (): void => {
      // health.uptime is the snapshot at fetch time; tick locally so it stays live.
      const elapsed = Math.floor(health.uptime);
      const m = Math.floor(elapsed / 60);
      const hrs = Math.floor(m / 60);
      const text =
        hrs > 0 ? `up ${hrs}h ${m % 60}m`
        : m > 0 ? `up ${m}m`
        : `up ${elapsed}s`;
      setUptimeText(text);
    };
    update();
  }, [health]);

  const toolCount = health?.tools.length ?? 0;

  return (
    <footer className="health-footer">
      <span className="health-uptime">{uptimeText}</span>
      <span className="health-tools">
        <strong>{toolCount}</strong> tools loaded
      </span>
    </footer>
  );
}
