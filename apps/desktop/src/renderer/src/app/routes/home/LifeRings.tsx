import type { CSSProperties } from 'react';
import type { LifeRing } from '@selfos/core/home';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * The "life-rings" whole-life glance (60 §3.1.6) — a few derived rings (Wellbeing / Connection / Reflection
 * / Growth), each with a level word AND a % (the owner's choice). Framed as "a reflection, not a score to
 * chase". During a crisis every ring is `softened`: the number/bar is hidden and only the supportive level
 * word shows (§8). Self-hides when no ring has a contributing signal. Meaning is never color-only — the
 * level word + % are real text (§9).
 */
export function LifeRings({ rings }: { rings: LifeRing[] }): JSX.Element | null {
  if (rings.length === 0) return null;
  const softened = rings.some((r) => r.softened);
  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className={styles.railTitle}>
          Your life, lately
        </Heading>
        <ul className={styles.ringsRow}>
          {rings.map((ring) => (
            <li key={ring.key} className={styles.ringItem}>
              <span
                className={`${styles.ring}${ring.softened ? ` ${styles.ringSoftened}` : ''}`}
                data-ring={ring.key}
                style={{ '--ring-fill': ring.value } as CSSProperties}
              >
                <span className={styles.ringInner}>{ring.levelLabel}</span>
              </span>
              <span className={styles.ringLabel}>{ring.label}</span>
              {ring.softened ? null : <span className={styles.ringPct}>{ring.pct}%</span>}
            </li>
          ))}
        </ul>
        <Text size="xs" tone="tertiary">
          {softened
            ? 'A gentle snapshot — be kind to yourself right now.'
            : 'A reflection of your check-ins, sessions & Together — not a score to chase.'}
        </Text>
      </Stack>
    </Card>
  );
}
