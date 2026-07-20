import type { TogetherCatalogEntry } from '@shared/schemas';
import styles from './Together.module.css';

/** The eyebrow line: framework, plus a "N steps" marker for a structured practice (§166 — clarity). */
export function practiceEyebrow(
  entry: Pick<TogetherCatalogEntry, 'framework' | 'stepCount'>,
): string {
  return entry.stepCount > 0 ? `${entry.framework} · ${entry.stepCount} steps` : entry.framework;
}

/**
 * One guided-practice card (58 §3.10) — eyebrow (framework + steps), title, and a blurb clamped to 2 lines
 * (§3.2a/§12 density: unclamped full-width blurbs were the biggest contributor to the old scroll length).
 * Picking it opens the start modal. Shared by the Practices tab and the Desire & intimacy panel.
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
