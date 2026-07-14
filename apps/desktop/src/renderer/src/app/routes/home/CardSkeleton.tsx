import styles from './Home.module.css';

/**
 * A loading placeholder for an async card region (60 §3.2) — a few shimmer bars matched to a card's
 * footprint so opening Home is never a blank flash and never a layout jump when data lands. `aria-hidden`
 * so screen-reader users aren't read the shimmer; the shimmer respects `prefers-reduced-motion` (in CSS).
 */
export function CardSkeleton({
  lines = 3,
  minHeight,
}: {
  lines?: number;
  minHeight?: number;
}): JSX.Element {
  return (
    <div
      className={styles.skCard}
      aria-hidden="true"
      {...(minHeight ? { style: { minHeight } } : {})}
    >
      <span className={styles.skBar} style={{ width: '42%' }} />
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className={styles.skBar} style={{ width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}
