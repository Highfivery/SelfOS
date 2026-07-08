import { ConfidenceDots } from './ConfidenceDots';
import { areaIcon } from './lifeAreaIcons';
import { confidenceLabel, type AreaSummary } from './overview';
import styles from './Memory.module.css';

/**
 * One life-area tile on the Memory overview (57 §3.1) — icon, area name, a live-fact count, a one-line gist,
 * and a confidence read (dots + text label, never colour-only). A button; clicking drills into the area.
 */
export function LifeAreaTile({
  summary,
  onOpen,
}: {
  summary: AreaSummary;
  onOpen: () => void;
}): JSX.Element {
  const Icon = areaIcon(summary.area);
  const things = `${summary.factCount} ${summary.factCount === 1 ? 'thing' : 'things'}`;
  return (
    <button
      type="button"
      className={styles.tile}
      onClick={onOpen}
      aria-label={`${summary.area} — ${things}, ${confidenceLabel(summary.confidenceLevel)}`}
    >
      <span className={styles.tileTop}>
        <span className={styles.tileChip}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className={styles.tileName}>{summary.area}</span>
        <span className={styles.tileNum}>{summary.factCount}</span>
      </span>
      {summary.gist ? <span className={styles.tilePreview}>{summary.gist}</span> : null}
      <span className={styles.tileFoot}>
        <ConfidenceDots level={summary.confidenceLevel} />
        <span className={styles.confLabel}>{confidenceLabel(summary.confidenceLevel)}</span>
      </span>
    </button>
  );
}
