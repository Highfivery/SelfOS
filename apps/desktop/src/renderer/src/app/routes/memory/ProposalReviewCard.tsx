import { useState } from 'react';
import { GitMerge } from 'lucide-react';
import type { MergeProposal } from '@shared/schemas';
import { Banner, Button, Stack, Text } from '../../../design-system/components';
import { useInsightStore } from '../../../stores/insightStore';
import styles from './Memory.module.css';

/**
 * A merge/duplicate proposal in the review queue (65 §3.3, on 39 §3.4). Shows the two summaries reconciliation
 * thinks are the same and offers three choices: **Merge into one** (`resolveProposal('merge')`) · **Keep both**
 * (`resolveProposal('keepBoth')`) · **Discard new** — the two-write reuse (`keepBoth` then `remove(fromId)`, the
 * folded-away insight), with error handling so a failed second write surfaces the partial state (§11). Resolving
 * removes the proposal from the store, which auto-advances the queue.
 */
export function ProposalReviewCard({
  proposal,
  onError,
}: {
  proposal: MergeProposal;
  /** Report a failure that the CARD can't show — the "Discard new" second write lands after this card
   * unmounts (its first write removes the proposal from the queue), so its error must surface at queue level. */
  onError?: (message: string) => void;
}): JSX.Element {
  const resolveProposal = useInsightStore((s) => s.resolveProposal);
  const remove = useInsightStore((s) => s.remove);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Merge / Keep both are single writes — on failure the proposal is NOT removed, so this card stays mounted
  // and its own Banner shows the error.
  const guard = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(message);
      setBusy(false);
    }
  };

  const onMerge = (): Promise<void> =>
    guard(() => resolveProposal(proposal.id, 'merge'), 'Couldn’t merge those. Please try again.');
  const onKeepBoth = (): Promise<void> =>
    guard(() => resolveProposal(proposal.id, 'keepBoth'), 'Couldn’t keep both. Please try again.');
  // "Discard new" reuses existing channels: dismiss the proposal (keep both), then delete the fold-away insight.
  // The first write removes the proposal → THIS card unmounts before the second `remove` resolves, so a failed
  // second write is reported to the queue (which stays mounted), never to a dead component (§11).
  const onDiscardNew = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await resolveProposal(proposal.id, 'keepBoth');
      await remove({ subjectPersonId: proposal.subjectPersonId, id: proposal.fromId });
    } catch {
      onError?.(
        'Kept both, but couldn’t discard the new one — remove it from its life-area section.',
      );
      setBusy(false);
    }
  };

  return (
    <Stack gap={3}>
      <div className={styles.eyebrowRow}>
        <span className={styles.sourcePill}>
          <GitMerge size={12} aria-hidden="true" /> Possible duplicate
        </span>
      </div>
      <Text tone="secondary">These two look like the same thing — combine them into one?</Text>
      <Stack gap={2}>
        <div className={styles.proposalSummary}>{proposal.intoSummary}</div>
        <div className={styles.proposalSummary}>{proposal.fromSummary}</div>
      </Stack>

      {error ? <Banner tone="warning">{error}</Banner> : null}

      <div className={styles.reviewActions}>
        <Button variant="primary" onClick={() => void onMerge()} disabled={busy}>
          Merge into one
        </Button>
        <Button variant="secondary" onClick={() => void onKeepBoth()} disabled={busy}>
          Keep both
        </Button>
        <span className={styles.reviewActionsSpacer} />
        <Button variant="ghost" onClick={() => void onDiscardNew()} disabled={busy}>
          Discard new
        </Button>
      </div>
    </Stack>
  );
}
