import styles from './Story.module.css';
import { useState } from 'react';
import type { StoryBookBundle } from '@shared/schemas';
import { WordDiff } from './WordDiff';

/**
 * The Shape-mode ribbon a new/updated chapter leads with (§13.5): a status eyebrow + an optional "What changed"
 * toggle (a real word-diff, only when there's prior text to diff) + the "Looks good ✓" review action. A reviewed
 * chapter shows a calm "Reviewed" line instead.
 */
export function ChapterRibbon({
  chapter,
  onReview,
}: {
  chapter: StoryBookBundle['chapters'][number];
  onReview: () => void;
}): JSX.Element | null {
  const [showDiff, setShowDiff] = useState(false);
  const canDiff = Boolean(chapter.previousMarkdown?.trim());
  if (chapter.status === 'reviewed') {
    return (
      <div className={styles.ribbon} data-reviewed>
        <span className={styles.ribbonLead}>Reviewed</span>
      </div>
    );
  }
  // new / updated both lead with the ribbon + the spend-free "Looks good ✓" accept action. A `generating`
  // chapter has no review action, so it shows nothing. Drift is no longer a status (72 §4.4) — it renders
  // as its own proposal above the prose.
  if (chapter.status !== 'new' && chapter.status !== 'updated') return null;
  const lead = chapter.status === 'new' ? 'New chapter' : 'Rewritten from new material';
  return (
    <div className={styles.ribbon}>
      <div className={styles.ribbonRow}>
        <span className={styles.ribbonLead}>{lead}</span>
        {canDiff ? (
          <button
            type="button"
            className={styles.ribbonLink}
            aria-expanded={showDiff}
            onClick={() => setShowDiff((v) => !v)}
          >
            {showDiff ? 'Hide changes' : 'What changed'}
          </button>
        ) : null}
        <button type="button" className={styles.ribbonPrimary} onClick={onReview}>
          Looks good <span aria-hidden="true">✓</span>
        </button>
      </div>
      {showDiff && chapter.previousMarkdown ? (
        <WordDiff previous={chapter.previousMarkdown} current={chapter.markdown} />
      ) : null}
    </div>
  );
}
