import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { TitlebarControl } from '../design-system/components';
import styles from './SyncStatusChip.module.css';

/**
 * The titlebar vault/sync status chip (02-app-shell §13.3). A calm "all synced" check by default;
 * when sync-conflict copies are present it turns to a warning icon + count that opens the vault folder
 * to resolve (the detailed in-content Banner stays alongside it). Always icon + text, never colour
 * alone (01-design-system §9).
 */
export function SyncStatusChip({ conflicts }: { conflicts: string[] }): JSX.Element {
  const count = conflicts.length;
  const hasConflicts = count > 0;
  // Both states open the vault folder on click, so both labels name that action (the chip is
  // announced as a button, so its accessible name must signal what activating it does).
  const label = hasConflicts
    ? `${count} sync ${count === 1 ? 'conflict' : 'conflicts'} — open the vault folder to resolve`
    : 'Vault: all synced — open the vault folder';

  return (
    <TitlebarControl
      tone={hasConflicts ? 'warning' : 'default'}
      aria-label={label}
      title={label}
      onClick={() => void window.selfos?.revealVault()}
    >
      {hasConflicts ? (
        <>
          <TriangleAlert size={16} aria-hidden="true" />
          <span className={styles.count}>{count}</span>
        </>
      ) : (
        <CheckCircle2 size={16} aria-hidden="true" />
      )}
    </TitlebarControl>
  );
}
