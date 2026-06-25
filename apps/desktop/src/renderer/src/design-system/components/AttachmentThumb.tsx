import { ImageOff } from 'lucide-react';
import styles from './AttachmentThumb.module.css';

/**
 * A square image thumbnail (45-session-attachments §3.3). Presentational: it renders a `src` (a data URL the
 * caller resolves) inside a focusable `<button>` that opens a lightbox, or a calm "image unavailable"
 * placeholder when `src` is absent (a corrupt/missing attachment, §7). The alt text never derives from the
 * image content (§9) — the caller passes a generic label.
 */
export function AttachmentThumb({
  src,
  alt,
  onActivate,
}: {
  src: string | null;
  alt: string;
  /** Open the lightbox. Omit for a non-interactive thumbnail. */
  onActivate?: () => void;
}): JSX.Element {
  const inner = src ? (
    <img className={styles.img} src={src} alt={alt} loading="lazy" />
  ) : (
    <span className={styles.missing} aria-label="Image unavailable">
      <ImageOff size={18} aria-hidden="true" />
    </span>
  );
  if (!onActivate) return <span className={styles.thumb}>{inner}</span>;
  return (
    <button type="button" className={styles.thumb} onClick={onActivate} aria-label={alt}>
      {inner}
    </button>
  );
}
