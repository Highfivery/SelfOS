import type { TogetherCatalogEntry } from '@shared/schemas';
import styles from './Together.module.css';

/** The eyebrow line: framework, plus a "N steps" marker for a structured practice (§166 — clarity). */
export function practiceEyebrow(
  entry: Pick<TogetherCatalogEntry, 'framework' | 'stepCount'>,
): string {
  return entry.stepCount > 0 ? `${entry.framework} · ${entry.stepCount} steps` : entry.framework;
}

/**
 * One full-width guided-practice card (58 §3.10) — eyebrow (framework + steps), title, and the FULL blurb
 * (never clamped, §166) so it's clear what the practice is. Picking it raises it to the start bar. Shared by
 * the main catalog and the Desire & intimacy panel.
 */
export function PracticeCard({
  entry,
  selected,
  onPick,
}: {
  entry: TogetherCatalogEntry;
  selected: boolean;
  onPick: (entry: TogetherCatalogEntry) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={styles.practiceCard}
      aria-pressed={selected}
      data-selected={selected}
      onClick={() => onPick(entry)}
    >
      <span className={styles.practiceEyebrow}>{practiceEyebrow(entry)}</span>
      <span className={styles.practiceTitle}>{entry.title}</span>
      <span className={styles.practiceBlurb}>{entry.blurb}</span>
    </button>
  );
}
