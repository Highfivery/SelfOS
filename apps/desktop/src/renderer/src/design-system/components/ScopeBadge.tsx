import { Laptop, RefreshCw } from 'lucide-react';
import styles from './ScopeBadge.module.css';

/**
 * A quiet, informational signal of where a setting lives (41 §3.4): `vault` = synced across the user's
 * devices, `device` = stored on this device only. Driven by `SettingDefinition.scope`. It changes no
 * behaviour. It is deliberately a borderless ghost label so it never competes with — or visually collides
 * with — the bordered "Admin only" pill (both can sit on one setting). The visible text carries the
 * meaning (never colour alone), and an `aria-label` gives the fuller phrase to screen readers, distinct
 * from the Admin marker's name.
 */
export function ScopeBadge({ scope }: { scope: 'vault' | 'device' }): JSX.Element {
  if (scope === 'device') {
    return (
      <span
        className={styles.badge}
        aria-label="This device only"
        title="Stored on this device only — not synced."
      >
        <Laptop size={12} className={styles.icon} aria-hidden="true" />
        This device
      </span>
    );
  }
  return (
    <span
      className={styles.badge}
      aria-label="Synced across devices"
      title="Synced across your devices through your vault."
    >
      <RefreshCw size={12} className={styles.icon} aria-hidden="true" />
      Synced
    </span>
  );
}
