import styles from './GoalStatusChip.module.css';

export type GoalStatusValue = 'open' | 'inProgress' | 'done' | 'stale' | 'abandoned';

const LABEL: Record<GoalStatusValue, string> = {
  open: 'Open',
  inProgress: 'In progress',
  done: 'Done',
  stale: 'Open a while',
  abandoned: 'Let go',
};

/**
 * A compact, labelled goal-status indicator (39-living-memory §3.1 / §9). The status is conveyed as **text**
 * (never colour alone — accessibility §9); a subtle tone via `data-status` only reinforces it. Used in the
 * Memory Goals section; showcased in `/gallery`.
 */
export function GoalStatusChip({ status }: { status: GoalStatusValue }): JSX.Element {
  return (
    <span className={styles.chip} data-status={status}>
      {LABEL[status]}
    </span>
  );
}
