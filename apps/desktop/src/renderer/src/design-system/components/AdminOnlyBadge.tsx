import { Lock } from 'lucide-react';
import styles from './AdminOnlyBadge.module.css';

/**
 * Marks a control or section that only admins (an Owner or the concealed super-admin) can see, so
 * admins know normal users don't (CLAUDE.md §12). Informational, not interactive — pair it with the
 * heading or control it qualifies. The icon + text never rely on colour alone.
 */
export function AdminOnlyBadge(): JSX.Element {
  return (
    <span className={styles.badge} title="Only Owners and the super-admin can see this.">
      <Lock size={12} className={styles.icon} aria-hidden="true" />
      Admin only
    </span>
  );
}
