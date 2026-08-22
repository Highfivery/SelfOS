import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Info, type LucideIcon } from 'lucide-react';
import styles from './Banner.module.css';

type Tone = 'info' | 'warning' | 'danger';

const ICONS: Record<Tone, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
};

interface BannerProps {
  tone?: Tone;
  children: ReactNode;
  /**
   * STATIC guidance rather than something that just happened. A live region announces CHANGE, so standing
   * instructions in one are both noise for a screen reader and a magnet for any `getByRole('status')`
   * looking for the real one on the same screen.
   *
   * `none` OMITS the attribute rather than emitting `role="none"` (which in ARIA means *presentation* and
   * would strip the element's semantics) — the banner stays a plain container, just not a live region.
   */
  role?: 'status' | 'alert' | 'none';
}

/** An inline notice strip for non-blocking messages (e.g. a sync conflict was found). */
export function Banner({ tone = 'info', children, role = 'status' }: BannerProps): JSX.Element {
  const Icon = ICONS[tone];
  return (
    <div className={`${styles.banner} ${styles[tone]}`} {...(role === 'none' ? {} : { role })}>
      <Icon size={16} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>{children}</div>
    </div>
  );
}
