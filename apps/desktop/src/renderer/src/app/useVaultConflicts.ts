import { useEffect, useState } from 'react';

/**
 * Tracks sync-conflict copies in the active vault: fetches on mount and refreshes whenever the vault
 * changes on disk (via the `vault:changed` event). Returns absolute paths of any conflict files.
 */
export function useVaultConflicts(): string[] {
  const [conflicts, setConflicts] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      const found = await window.selfos?.getConflicts();
      if (active && found) setConflicts(found);
    };
    void refresh();
    const off = window.selfos?.onVaultChanged(() => void refresh());
    return () => {
      active = false;
      off?.();
    };
  }, []);

  return conflicts;
}
