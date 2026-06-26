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
  /** The live-region role. Defaults to a polite `status`; pass `alert` for a crisis/safety surface that
   *  must be announced assertively (51 §9 — the wellbeing crisis interception). */
  role?: 'status' | 'alert';
}

/** An inline notice strip for non-blocking messages (e.g. a sync conflict was found). */
export function Banner({ tone = 'info', children, role = 'status' }: BannerProps): JSX.Element {
  const Icon = ICONS[tone];
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role={role}>
      <Icon size={16} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>{children}</div>
    </div>
  );
}
