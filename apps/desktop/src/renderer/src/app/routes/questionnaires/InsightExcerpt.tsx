import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Markdown } from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/**
 * The analysed Sent card's Insight excerpt (08 §3.1). The summary is AI prose, so it renders through the
 * shared safe <Markdown> (34) and is clamped to a few WHOLE lines — the clamp lives on a padding-free
 * element so the cut is always a clean ellipsis, never a half-sliced line bleeding into the padding. The
 * affordances sit on their own row BELOW the clamp so they can never be clipped away: "Show more" appears
 * only when the summary actually overflows (measured, re-checked on resize) and expands in place;
 * "View in Memory" always shows and deep-links to the exact insight.
 */
export function InsightExcerpt({
  summary,
  onViewInMemory,
}: {
  summary: string;
  onViewInMemory: () => void;
}): JSX.Element {
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  // Whether the clamped body actually hides text — measured, so a short summary never grows a dead
  // "Show more". Re-measured on resize (the card's grid column width changes with the window).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = (): void => {
      if (expanded) return; // nothing is clamped while expanded — keep the last collapsed reading
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, summary]);

  return (
    <div className={styles.excerpt}>
      <span className={styles.excerptLabel}>
        <Sparkles size={12} aria-hidden="true" />
        Insight
      </span>
      <div
        id={bodyId}
        ref={bodyRef}
        data-testid="insight-excerpt-body"
        className={
          expanded ? `${styles.excerptBody} ${styles.excerptBodyOpen}` : styles.excerptBody
        }
      >
        <Markdown tone="secondary" size="sm">
          {summary}
        </Markdown>
      </div>
      <div className={styles.excerptActions}>
        {expanded || overflowing ? (
          <button
            type="button"
            className={styles.excerptLink}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
        <button type="button" className={styles.excerptLink} onClick={onViewInMemory}>
          View in Memory →
        </button>
      </div>
    </div>
  );
}
