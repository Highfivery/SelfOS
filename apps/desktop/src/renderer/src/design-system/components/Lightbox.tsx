import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import styles from './Lightbox.module.css';

export interface LightboxImage {
  src: string;
  alt: string;
}

/**
 * A focus-trapped image lightbox (45-session-attachments §3.3/§9). A `role="dialog" aria-modal` overlay
 * showing the full-size (stored, downscaled) image, dismissable with Esc / the close button / a scrim click,
 * with prev/next when a message has several. Focus moves to the close button on open, Tab cycles WITHIN the
 * dialog, and focus is restored to the trigger on close. Respects reduced-motion (no zoom animation — CSS).
 */
export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
  onSave,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
  /** Optional "Save image" action for the current image (e.g. export outside the vault, 45 §11). */
  onSave?: () => void;
}): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const count = images.length;
  const current = images[index];

  // Move focus into the dialog on open; restore it to the trigger (the previously focused element) on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (count > 1 && event.key === 'ArrowLeft') onIndexChange((index - 1 + count) % count);
      if (count > 1 && event.key === 'ArrowRight') onIndexChange((index + 1) % count);
      // Trap Tab within the dialog so focus can't reach the page behind the modal.
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, index, onClose, onIndexChange]);

  if (!current) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={count > 1 ? `Attachment ${index + 1} of ${count}` : 'Attachment'}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} aria-hidden="true" />
        </button>
        {onSave ? (
          <button type="button" className={styles.save} onClick={onSave} aria-label="Save image">
            <Download size={18} aria-hidden="true" />
          </button>
        ) : null}
        {count > 1 ? (
          <button
            type="button"
            className={`${styles.nav} ${styles.prev}`}
            onClick={() => onIndexChange((index - 1 + count) % count)}
            aria-label="Previous image"
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
        ) : null}
        <img className={styles.image} src={current.src} alt={current.alt} />
        {count > 1 ? (
          <button
            type="button"
            className={`${styles.nav} ${styles.next}`}
            onClick={() => onIndexChange((index + 1) % count)}
            aria-label="Next image"
          >
            <ChevronRight size={24} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
