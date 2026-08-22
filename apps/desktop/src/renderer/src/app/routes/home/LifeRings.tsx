import type { LifeRing, LifeRingKey } from '@selfos/core/home';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import { Ring } from './Ring';
import styles from './Home.module.css';

/** The chart token that colours each ring's arc. */
const RING_COLOR: Record<LifeRingKey, string> = {
  wellbeing: 'var(--color-chart-1)',
  connection: 'var(--color-chart-4)',
  reflection: 'var(--color-chart-2)',
  growth: 'var(--color-chart-3)',
};

/**
 * The "life-rings" whole-life glance (60 §3.1.6) — a few derived rings (Wellbeing / Connection / Reflection /
 * Growth), each an SVG progress ring with the % inside and a level word below. Framed as "a reflection, not a
 * score to chase".
 * ring with only the supportive level word — a calm, intentional snapshot, never an empty circle (§8). Meaning
 * is real text (% + level word), never colour-only (§9). Self-hides when no ring has a contributing signal.
 */
export function LifeRings({ rings }: { rings: LifeRing[] }): JSX.Element | null {
  if (rings.length === 0) return null;
  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className={styles.railTitle}>
          Your life, lately
        </Heading>
        <ul className={styles.ringsRow}>
          {rings.map((ring) => (
            <li key={ring.key} className={styles.ringItem}>
              <Ring fill={ring.value} color={RING_COLOR[ring.key]} size={58} stroke={6}>
                <span className={styles.ringPct}>{ring.pct}%</span>
              </Ring>
              <span className={styles.ringLabel}>{ring.label}</span>
              <span className={styles.ringLevel}>{ring.levelLabel}</span>
            </li>
          ))}
        </ul>
        <Text size="xs" tone="tertiary">
          A reflection of your check-ins, sessions &amp; Together — not a score to chase.
        </Text>
      </Stack>
    </Card>
  );
}
