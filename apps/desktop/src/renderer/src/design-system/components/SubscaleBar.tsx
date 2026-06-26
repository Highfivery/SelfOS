import styles from './SubscaleBar.module.css';

interface SubscaleBarProps {
  label: string;
  /** The normalized score: 0..1 for a unit subscale, −1..1 for a signed one. */
  normalized: number;
  /** A plain, non-pathologizing descriptor band (e.g. "leans higher"). Shown as text. */
  band?: string | undefined;
  /** A signed subscale (−1..1) renders a centered bar; a unit subscale (0..1) renders left-anchored. */
  signed?: boolean;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * 50-self-assessments §3.3 — one subscale of a self-assessment result, as a labelled bar. The value is
 * rendered as **text** (a percent for a unit subscale, a signed number for a bipolar one) AND a bar, and the
 * descriptor band is text — never colour alone (01 §9). A signed subscale fills from the centre toward the
 * leaning side. A design-system primitive (in `/gallery`).
 */
export function SubscaleBar({
  label,
  normalized,
  band,
  signed = false,
}: SubscaleBarProps): JSX.Element {
  // Figure text: "+0.4" / "−0.4" / "0" for signed; "62%" for unit.
  const figure = signed
    ? normalized === 0
      ? '0'
      : `${normalized > 0 ? '+' : '−'}${Math.abs(normalized).toFixed(2)}`
    : `${Math.round(clamp01(normalized) * 100)}%`;

  // Bar geometry. Unit: left-anchored width. Signed: from centre, half-width either side.
  const half = clamp01(Math.abs(normalized)) * 50;
  const barStyle = signed
    ? normalized >= 0
      ? { left: '50%', width: `${half}%` }
      : { left: `${50 - half}%`, width: `${half}%` }
    : { left: 0, width: `${clamp01(normalized) * 100}%` };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.figure}>
          {band ? <span className={styles.band}>{band}</span> : null}
          <span className={styles.value}>{figure}</span>
        </span>
      </div>
      <span className={`${styles.track} ${signed ? styles.signed : ''}`} aria-hidden="true">
        {signed ? <span className={styles.center} /> : null}
        <span className={styles.fill} style={barStyle} />
      </span>
    </div>
  );
}
