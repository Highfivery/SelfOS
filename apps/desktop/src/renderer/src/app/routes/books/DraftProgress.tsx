import { Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import styles from './Books.module.css';
import { useEffect, useState } from 'react';
import type { StoryBookBundle, StoryDraftProgress } from '@shared/schemas';

/** mm:ss for a millisecond duration. */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** A soft "about N left" from the observed pace (only once ≥1 chapter is done, so it's real, not guessed). */
export function estimateRemaining(elapsedMs: number, done: number, total: number): string | null {
  if (done < 1 || total <= done) return null;
  const perChapter = elapsedMs / done;
  const leftSec = Math.round((perChapter * (total - done)) / 1000);
  if (leftSec <= 15) return 'almost done';
  if (leftSec < 90) return `about ${leftSec} sec left`;
  return `about ${Math.round(leftSec / 60)} min left`;
}
/**
 * The create-and-draft progress screen (§3.2) — real per-chapter progress with a live timer + estimate, and a
 * clear "you can keep working, this continues in the background" note. Driven by the store's `progress` (which
 * is fed by the main-side stream and survives navigation), so returning to /story mid-draft shows live status.
 */
export function DraftProgress({
  p,
  outline = null,
  essence,
  onBrowse,
}: {
  p: StoryDraftProgress & { startedAt: number };
  outline?: StoryBookBundle['outline'] | null;
  essence?: string;
  onBrowse?: () => void;
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const writing = p.phase === 'writing';
  const total = p.chaptersTotal;
  const done = p.chaptersDone;
  const elapsed = now - p.startedAt;
  const pct = writing && total > 0 ? Math.min(99, 15 + (done / total) * 84) : 8;
  const eta = writing ? estimateRemaining(elapsed, done, total) : null;
  // A chapter is four passes now (72 §5.3), each of them minutes long — so name the one that's running,
  // or the bar sits on "chapter 3 of 24" with nothing moving and reads as hung (§12).
  const craftLabel =
    p.craft === 'planning'
      ? 'finding the scenes'
      : p.craft === 'drafting'
        ? 'writing it'
        : p.craft === 'critiquing'
          ? 'reading it back'
          : p.craft === 'revising'
            ? 'working on it again'
            : null;
  const phaseLabel = writing
    ? p.currentTitle
      ? `${craftLabel ? `${craftLabel[0]!.toUpperCase()}${craftLabel.slice(1)}` : 'Writing'} — “${p.currentTitle}”, chapter ${Math.min(done + 1, total)} of ${total}`
      : `Writing your chapters — ${done} of ${total}`
    : 'Reading everything you’ve shared, and shaping the outline…';

  // The outline reveals itself as it lands (the foundations pass) — chapters in order, marked done/current/
  // upcoming from the progress stream. A calm two-column list; falls back to anonymous dots before it lands.
  const chapters = outline
    ? outline.parts.flatMap((part) => part.chapters).sort((a, b) => a.order - b.order)
    : [];

  return (
    <Card>
      <Stack gap={4}>
        <Inline gap={3}>
          <div className={styles.draftIcon} aria-hidden="true">
            <span className={styles.draftSpinner} />
          </div>
          <Stack gap={1}>
            <Heading level={2}>Writing your story</Heading>
            <Text tone="secondary" size="sm" aria-live="polite">
              {phaseLabel}
            </Text>
          </Stack>
        </Inline>

        {essence ? <p className={styles.draftEssence}>{essence}</p> : null}

        <Stack gap={2}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(writing && total > 0 ? { 'aria-valuenow': Math.round(pct) } : {})}
            aria-label="Writing progress"
          >
            <div
              className={writing ? styles.progressFill : styles.progressIndeterminate}
              style={writing ? { width: `${pct}%` } : undefined}
            />
          </div>
          <Inline justify="space-between">
            <Text size="sm" tone="secondary">
              {fmtDuration(elapsed)} elapsed
            </Text>
            <Text size="sm" tone="secondary">
              {eta ?? (writing ? 'estimating…' : 'this takes a moment')}
            </Text>
          </Inline>
        </Stack>

        {chapters.length > 0 ? (
          <ol className={styles.draftOutline} aria-label="Chapters">
            {chapters.map((chapter, i) => {
              const state = i < done ? 'done' : i === done && writing ? 'current' : 'upcoming';
              return (
                <li key={chapter.id} className={styles.draftOutlineItem} data-state={state}>
                  <span className={styles.draftOutlineMark} aria-hidden="true">
                    {state === 'done' ? '✓' : state === 'current' ? '✎' : '·'}
                  </span>
                  <span className={styles.draftOutlineTitle}>{chapter.title}</span>
                </li>
              );
            })}
          </ol>
        ) : writing && total > 0 ? (
          <div className={styles.progressDots} aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={
                  i < done
                    ? `${styles.dot} ${styles.dotDone}`
                    : i === done
                      ? `${styles.dot} ${styles.dotCurrent}`
                      : styles.dot
                }
              />
            ))}
          </div>
        ) : null}

        <div className={styles.draftNote}>
          <Text size="sm">
            You don’t have to watch — your biographer keeps writing in the background. We’ll have
            your book ready when you come back.
          </Text>
          {onBrowse ? (
            <button type="button" className={styles.draftBrowse} onClick={onBrowse}>
              Browse SelfOS ›
            </button>
          ) : null}
        </div>
      </Stack>
    </Card>
  );
}
