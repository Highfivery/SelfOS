import { Inline, Text } from '../../../design-system/components';
import styles from './Story.module.css';
import type { StoryCompleteness } from '@shared/schemas';
import { COMPLETENESS_STAGE } from './SharedWithYou';

/** How far along the story is — a warm stage label + a quiet progress bar (never a bare percentage). */
export function CompletenessMeter({ c }: { c: StoryCompleteness }): JSX.Element {
  const label = COMPLETENESS_STAGE[c.stage];
  const pct = Math.round(c.ratio * 100);
  return (
    <div className={styles.completeness}>
      <Inline justify="space-between">
        <Text size="sm" className={styles.rowTitle}>
          Your story so far
        </Text>
        <Text size="sm" tone="secondary">
          {label}
        </Text>
      </Inline>
      <div
        className={styles.meterTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={label}
        aria-label={`Your story is ${label.toLowerCase()}`}
      >
        <div className={styles.meterFill} style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </div>
  );
}
