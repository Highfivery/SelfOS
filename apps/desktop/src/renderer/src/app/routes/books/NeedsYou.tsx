import { Button, Inline, Text } from '../../../design-system/components';
import styles from './Books.module.css';
import type { StructuralProposal } from '@shared/schemas';
import { proposalSummary } from './markupHelpers';
import type { DriftCard } from './driftCards';

/** The "Needs you" strip (§13.4) — one card per pending decision. Self-hides entirely when you're caught up
 *  (replaced by a calm "all caught up" line). */
export function NeedsYou({
  proposals,
  drift,
  toReviewCount,
  openTodoCount,
  contributionCount = 0,
  onReview,
  onOpenTodos,
  onOpenContributions,
  onApprove,
  onDismiss,
  onWeaveIn,
  onNotNow,
  busy,
  unitOne = 'chapter',
  unitMany = 'chapters',
}: {
  proposals: StructuralProposal[];
  drift: DriftCard[];
  toReviewCount: number;
  openTodoCount: number;
  /** Offerings from household members waiting on an accept/decline (73 §3.4). */
  contributionCount?: number;
  onReview: () => void;
  onOpenTodos: () => void;
  onOpenContributions?: () => void;
  onApprove: (proposalId: string) => void | Promise<void>;
  onDismiss: (proposalId: string) => void;
  onWeaveIn: (chapterId: string) => void | Promise<void>;
  onNotNow: (chapterId: string) => void | Promise<void>;
  /** What this kind of book is counted in (72 §3.1) — "2 newly written chapters" is the wrong noun for a
   *  picture book, and the shelf and workspace already say pages. */
  unitOne?: string;
  unitMany?: string;
  busy: boolean;
}): JSX.Element {
  const nothing =
    proposals.length === 0 &&
    drift.length === 0 &&
    toReviewCount === 0 &&
    openTodoCount === 0 &&
    contributionCount === 0;
  if (nothing) {
    return (
      <div className={styles.caughtUp}>
        <Text size="sm" tone="secondary">
          ✓ Nothing needs you — your story is up to date.
        </Text>
      </div>
    );
  }
  const count =
    proposals.length +
    drift.length +
    (toReviewCount > 0 ? 1 : 0) +
    (openTodoCount > 0 ? 1 : 0) +
    (contributionCount > 0 ? 1 : 0);
  return (
    <div className={styles.needs}>
      <div className={styles.needsHead}>
        <span className={styles.partEyebrow}>Needs you</span>
        <Text size="sm" tone="tertiary">
          {count} thing{count === 1 ? '' : 's'} · this clears as you go
        </Text>
      </div>
      <div className={styles.needsGrid}>
        {/* Drift proposals (72 §4.4) — what a chapter has fallen out of step with. Nothing is rewritten
            until the author says so, and "Not now" means it stays quiet until something else changes. */}
        {drift.map((d) => (
          <div key={d.chapterId} className={styles.needCard}>
            <span className={d.hasMaterial ? styles.needKind : styles.needKindWarn}>
              {d.hasMaterial ? 'New material' : 'Out of step'}
            </span>
            <Text size="sm" className={styles.needTitle}>
              {d.title}
            </Text>
            {d.lines.map((line) => (
              <Text key={line} size="sm" tone="tertiary">
                {line}
              </Text>
            ))}
            <Inline gap={2}>
              <Button variant="primary" disabled={busy} onClick={() => void onWeaveIn(d.chapterId)}>
                {d.hasMaterial ? 'Weave these in' : 'Rewrite it'}
              </Button>
              <button
                type="button"
                className={styles.sourcesToggle}
                aria-label={`Not now for ${d.title}`}
                onClick={() => void onNotNow(d.chapterId)}
              >
                Not now
              </button>
            </Inline>
          </div>
        ))}
        {proposals.map((p) => (
          <div key={p.id} className={styles.needCard}>
            <span className={styles.needKindWarn}>Suggested change</span>
            <Text size="sm" className={styles.needTitle}>
              {proposalSummary(p)}
            </Text>
            {p.rationale ? (
              <Text size="sm" tone="tertiary">
                {p.rationale}
              </Text>
            ) : null}
            <Inline gap={2}>
              <Button variant="primary" onClick={() => void onApprove(p.id)}>
                Approve
              </Button>
              <button
                type="button"
                className={styles.sourcesToggle}
                aria-label="Dismiss this suggestion"
                onClick={() => onDismiss(p.id)}
              >
                Later
              </button>
            </Inline>
          </div>
        ))}
        {toReviewCount > 0 ? (
          <div className={styles.needCard}>
            <span className={styles.needKind}>To review</span>
            <Text size="sm" className={styles.needTitle}>
              {toReviewCount} newly written {toReviewCount === 1 ? unitOne : unitMany}
            </Text>
            <Text size="sm" tone="tertiary">
              Read {toReviewCount === 1 ? 'it' : 'them'} and mark “Looks good” to share.
            </Text>
            <Inline>
              <Button onClick={onReview}>Review ›</Button>
            </Inline>
          </div>
        ) : null}
        {contributionCount > 0 && onOpenContributions ? (
          <div className={styles.needCard}>
            <span className={styles.needKind}>From someone else</span>
            <Text size="sm" className={styles.needTitle}>
              {contributionCount === 1
                ? 'Someone added something'
                : `${contributionCount} things people added`}
            </Text>
            <Text size="sm" tone="tertiary">
              Nothing goes into your book until you say so.
            </Text>
            <Inline>
              <Button aria-label="Read what people added" onClick={onOpenContributions}>
                Read {contributionCount === 1 ? 'it' : 'them'} ›
              </Button>
            </Inline>
          </div>
        ) : null}
        {openTodoCount > 0 ? (
          <div className={styles.needCard}>
            <span className={styles.needKind}>To-dos</span>
            <Text size="sm" className={styles.needTitle}>
              {openTodoCount} open
            </Text>
            <Text size="sm" tone="tertiary">
              Your reminders and the notes you’ve handed your biographer.
            </Text>
            <Inline>
              <button type="button" className={styles.sourcesToggle} onClick={onOpenTodos}>
                View ›
              </button>
            </Inline>
          </div>
        ) : null}
      </div>
    </div>
  );
}
