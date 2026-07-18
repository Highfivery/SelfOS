import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Insight, MergeProposal, RelationshipType } from '@shared/schemas';
import { Banner, Button, Card, IconButton, Stack, Text } from '../../../design-system/components';
import { DraftReviewCard } from './DraftReviewCard';
import { ProposalReviewCard } from './ProposalReviewCard';
import styles from './Memory.module.css';

type QueueItem =
  | { kind: 'draft'; id: string; insight: Insight }
  | { kind: 'proposal'; id: string; proposal: MergeProposal };

/**
 * The focused, one-at-a-time Memory review queue (65 §3.3) — rendered on its own dedicated `/memory/review`
 * screen (`MemoryReview.tsx`), not inline on the Memory page and not a modal. Holds
 * the active person's **draft insights** (newest-first) then the **merge/duplicate proposals** (39). Chrome: a
 * card-stack visual conveying how many remain, a "N of M" progress read (+ a thin bar), Prev/Next to move
 * without deciding (← / → keys), and auto-advance — resolving an item removes it from the store, so the array
 * shrinks and the same index lands on the next. Ends on an "all caught up" state; the banner + sidebar badge
 * then drop to 0.
 */
export function ReviewQueue({
  drafts,
  proposals,
  availableTypes,
  partnerName,
  aboutNameFor,
  onClose,
}: {
  drafts: Insight[];
  proposals: MergeProposal[];
  availableTypes?: RelationshipType[];
  partnerName?: string;
  aboutNameFor: (insight: Insight) => string | undefined;
  onClose?: () => void;
}): JSX.Element {
  const items = useMemo<QueueItem[]>(() => {
    const draftItems: QueueItem[] = [...drafts]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // newest-first
      .map((insight) => ({ kind: 'draft', id: insight.id, insight }));
    const proposalItems: QueueItem[] = proposals.map((proposal) => ({
      kind: 'proposal',
      id: proposal.id,
      proposal,
    }));
    return [...draftItems, ...proposalItems];
  }, [drafts, proposals]);

  const [index, setIndex] = useState(0);
  // A queue-level error survives the active card unmounting after a resolve (the "Discard new" two-write, §11).
  const [queueError, setQueueError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const total = items.length;
  const safeIndex = total > 0 ? Math.min(index, total - 1) : 0;

  // Clamp when the queue shrinks (an item resolved). Keeps the cursor on the next item, never past the end.
  useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1));
  }, [total, index]);

  // Move focus INTO the region on open + after each auto-advance (total shrinks on a resolve, unchanged on
  // manual Prev/Next) so keyboard nav works and the resolved card's focus doesn't drop to <body> (§9). Also
  // clears a stale queue-level error once the offending item is gone.
  useEffect(() => {
    if (total > 0) {
      sectionRef.current?.focus();
      setQueueError(null);
    }
  }, [total]);

  const active = items[safeIndex];

  // ← / → move without deciding; Escape closes. Ignore keys typed inside an editor (Edit-mode textareas).
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const t = event.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    if (event.key === 'Escape') onClose?.();
    if (event.key === 'ArrowLeft' && safeIndex > 0) setIndex(safeIndex - 1);
    if (event.key === 'ArrowRight' && safeIndex < total - 1) setIndex(safeIndex + 1);
  };

  if (total === 0 || !active) {
    return (
      <Card className={styles.reviewQueue}>
        <Stack gap={3} align="center">
          <span className={styles.allCaughtUpMark}>
            <Check size={22} aria-hidden="true" />
          </span>
          <Text tone="secondary">
            All caught up — nothing to review right now. SelfOS will surface new insights here as it
            learns.
          </Text>
          {onClose ? (
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          ) : null}
        </Stack>
      </Card>
    );
  }

  const remaining = total - safeIndex; // how many ghost cards to hint behind the active one (max 2)
  const ghosts = Math.min(remaining - 1, 2);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className={styles.reviewQueue}
      aria-label="Review new insights"
      onKeyDown={onKeyDown}
    >
      <div className={styles.reviewProgress}>
        <Text size="sm" tone="secondary">
          {safeIndex + 1} of {total} to review
        </Text>
        <div
          className={styles.reviewBar}
          role="progressbar"
          aria-label="Review progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={safeIndex + 1}
        >
          <span style={{ width: `${((safeIndex + 1) / total) * 100}%` }} />
        </div>
        <span className={styles.reviewProgressSpacer} />
        <IconButton
          aria-label="Previous"
          variant="ghost"
          disabled={safeIndex === 0}
          onClick={() => setIndex(safeIndex - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label="Next"
          variant="ghost"
          disabled={safeIndex >= total - 1}
          onClick={() => setIndex(safeIndex + 1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </IconButton>
        {onClose ? (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>

      {queueError ? <Banner tone="warning">{queueError}</Banner> : null}

      <div className={styles.reviewStack} data-ghosts={ghosts}>
        {ghosts >= 2 ? <div className={`${styles.reviewGhost} ${styles.reviewGhost2}`} /> : null}
        {ghosts >= 1 ? <div className={`${styles.reviewGhost} ${styles.reviewGhost1}`} /> : null}
        <Card className={styles.reviewCard}>
          {active.kind === 'draft' ? (
            <DraftReviewCard
              key={active.id}
              insight={active.insight}
              {...(aboutNameFor(active.insight)
                ? { aboutName: aboutNameFor(active.insight) as string }
                : {})}
              {...(availableTypes ? { availableTypes } : {})}
              {...(partnerName ? { partnerName } : {})}
            />
          ) : (
            <ProposalReviewCard
              key={active.id}
              proposal={active.proposal}
              onError={setQueueError}
            />
          )}
        </Card>
      </div>
    </section>
  );
}
