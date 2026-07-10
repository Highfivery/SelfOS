import { Eye, FileText, Layers, Lock } from 'lucide-react';
import type { PrivacyBadge } from './privacyBadge';
import styles from './Questionnaires.module.css';

const ICONS = { lock: Lock, eye: Eye, report: FileText, mixed: Layers } as const;

/**
 * The landing cards' privacy chip (08 §3.1 card privacy badges): icon + short label carrying the meaning
 * (never colour-only, §9), with the full honest disclosure sentence as the tooltip.
 */
export function PrivacyChip({ badge }: { badge: PrivacyBadge }): JSX.Element {
  const Icon = ICONS[badge.icon];
  return (
    <span
      className={`${styles.pchip} ${badge.protectedTone ? styles.pchipPriv : styles.pchipVis}`}
      title={badge.detail}
    >
      <Icon size={12} aria-hidden="true" />
      <span className={styles.pchipLabel}>{badge.label}</span>
    </span>
  );
}
