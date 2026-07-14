import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Collapsible } from '../../../design-system/components';
import { areaIcon } from './lifeAreaIcons';
import type { MemorySection } from './sections';
import styles from './Memory.module.css';

/**
 * One collapsible life-area section on the flattened Memory page (62 §3.2) — a header (area icon + name +
 * fact count + a lock marker for a sensitive area) that reveals its insight cards inline, edited in place.
 * Controlled by Memory (so all sections start collapsed, a deep-link can force one open, and sensitive
 * sections stay collapsed until the person opens them).
 */
export function LifeAreaSection({
  section,
  open,
  onOpenChange,
  children,
}: {
  section: MemorySection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The section's insight cards (rendered by Memory). */
  children: ReactNode;
}): JSX.Element {
  const Icon = areaIcon(section.area);
  return (
    <Collapsible
      className={styles.section}
      open={open}
      onOpenChange={onOpenChange}
      header={
        <>
          <span className={styles.sectionIcon}>
            <Icon size={16} aria-hidden="true" />
          </span>
          <span className={styles.sectionName}>{section.area}</span>
          {section.sensitive ? (
            <Lock size={13} aria-hidden="true" className={styles.sectionLock} />
          ) : null}
          <span className={styles.sectionCount}>
            {section.factCount} {section.factCount === 1 ? 'thing' : 'things'}
          </span>
        </>
      }
    >
      {children}
    </Collapsible>
  );
}
