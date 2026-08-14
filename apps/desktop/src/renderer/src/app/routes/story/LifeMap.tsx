import { Text } from '../../../design-system/components';
import styles from './Story.module.css';
import type { StoryPartCoverage } from '@shared/schemas';

/** Describe a 0..1 part-coverage score as words (§9 — never colour/height alone). */
export function coverageWord(score: number): string {
  if (score >= 0.8) return 'richly told';
  if (score >= 0.5) return 'taking shape';
  if (score > 0) return 'thin';
  return 'not yet begun';
}
/**
 * The life map (§13.6.4) — one row per outline part (chronological), a coverage bar + a word for how richly
 * told that era is (the text equivalent, §9), dashed when an open gap targets it.
 */
export function LifeMap({
  parts,
  coverage,
}: {
  parts: { id: string; title: string }[];
  coverage: StoryPartCoverage[];
}): JSX.Element | null {
  if (parts.length === 0) return null;
  const byPart = new Map(coverage.map((c) => [c.partId, c.score]));
  return (
    <div
      className={styles.lifeMap}
      role="group"
      aria-label="Life map — how richly told each part is"
    >
      {parts.map((part) => {
        const score = byPart.get(part.id) ?? 0;
        return (
          <div key={part.id} className={styles.lifeRow}>
            <Text size="sm" className={styles.lifeTitle}>
              {part.title}
            </Text>
            <div
              className={styles.lifeTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(score * 100)}
              aria-valuetext={coverageWord(score)}
              aria-label={part.title}
            >
              <div className={styles.lifeFill} style={{ width: `${Math.max(4, score * 100)}%` }} />
            </div>
            <Text size="sm" tone="tertiary" className={styles.lifeWord}>
              {coverageWord(score)}
            </Text>
          </div>
        );
      })}
    </div>
  );
}
