import { useEffect, useState } from 'react';
import { BootStateSchema, type BootState } from '@shared/schemas';

/**
 * Exercises the full preload → IPC → validation pipeline: fetches boot state via the bridge and
 * validates it with Zod. Returns null until resolved (or when running outside Electron, e.g. tests).
 */
export function useBootState(): BootState | null {
  const [state, setState] = useState<BootState | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await window.selfos?.getBootState();
        if (!raw) return;
        const parsed = BootStateSchema.parse(raw);
        if (active) setState(parsed);
      } catch {
        // Bridge unavailable or invalid payload; leave null and let the UI render without it.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
