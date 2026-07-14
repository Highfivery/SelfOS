import styles from './Memory.module.css';

/** One stat tile — a value over a muted label. */
function Stat({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/**
 * The Memory stats strip (62 §3.1) — a compact summary the page opens with: how many things SelfOS knows,
 * overall confidence, life areas with content, and when memory was last tidied. Deterministic, no AI.
 */
export function StatsStrip({
  total,
  confidence,
  areaCount,
  tidied,
}: {
  total: number;
  confidence: string;
  areaCount: number;
  tidied?: string;
}): JSX.Element {
  return (
    <div className={styles.statStrip}>
      <Stat value={String(total)} label={total === 1 ? 'thing known' : 'things known'} />
      <Stat value={confidence} label="overall confidence" />
      <Stat value={String(areaCount)} label={areaCount === 1 ? 'life area' : 'life areas'} />
      {tidied ? <Stat value={tidied} label="since tidied" /> : null}
    </div>
  );
}
