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
}

/** An inline notice strip for non-blocking messages (e.g. a sync conflict was found). */
export function Banner({ tone = 'info', children }: BannerProps): JSX.Element {
  const Icon = ICONS[tone];
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role="status">
      <Icon size={16} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>{children}</div>
    </div>
  );
}
