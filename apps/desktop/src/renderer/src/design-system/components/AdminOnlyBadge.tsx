import { Lock } from 'lucide-react';
import styles from './AdminOnlyBadge.module.css';

/**
 * Marks a control or section that only an Owner (the full-access role) can see, so admins know normal
 * users don't (CLAUDE.md §12). Informational, not interactive — pair it with the heading or control it
 * qualifies. The icon + text never rely on colour alone.
 */
export function AdminOnlyBadge(): JSX.Element {
  return (
    <span className={styles.badge} title="Only the household owner can see this.">
      <Lock size={12} className={styles.icon} aria-hidden="true" />
      Admin only
    </span>
  );
}
