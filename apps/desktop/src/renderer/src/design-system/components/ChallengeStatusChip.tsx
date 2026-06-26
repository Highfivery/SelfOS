import styles from './ChallengeStatusChip.module.css';

export type ChallengeStatusValue = 'proposed' | 'active' | 'done' | 'abandoned';

const LABEL: Record<ChallengeStatusValue, string> = {
  proposed: 'Suggested',
  active: 'Active',
  done: 'Done',
  abandoned: 'Let go',
};

/**
 * A compact, labelled challenge-status indicator (52-challenge-sessions §3.3 / §9). The status is conveyed as
 * **text** (never colour alone — accessibility §9); a subtle tone via `data-status` only reinforces it.
 * Mirrors `GoalStatusChip`. Showcased in `/gallery`.
 */
export function ChallengeStatusChip({ status }: { status: ChallengeStatusValue }): JSX.Element {
  return (
    <span className={styles.chip} data-status={status}>
      {LABEL[status]}
    </span>
  );
}
