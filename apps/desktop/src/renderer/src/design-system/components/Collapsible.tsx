import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Collapsible.module.css';

/**
 * A collapsible section (spec 62) — a full-width header button (`aria-expanded`) + a body that reveals on
 * open, with the spacing-between-header-and-body baked in (the §12 accordion rule, fixed once here). Used by
 * Memory's life-area sections, the responses band, the review callout, and the portrait read-more. Works
 * uncontrolled (`defaultOpen`) or controlled (`open` + `onOpenChange`, e.g. a deep-link forcing a section
 * open). The `header` slot renders left of the auto-appended chevron; a `lead` slot (optional) sits before it.
 */
export function Collapsible({
  header,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  headerClassName,
  bodyClassName,
}: {
  /** The header content rendered left of the chevron (icon + title + count, etc.). */
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state; when set, `onOpenChange` drives it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string | undefined;
  headerClassName?: string | undefined;
  bodyClassName?: string | undefined;
}): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;

  const toggle = (): void => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  return (
    <div className={className ? `${styles.collapsible} ${className}` : styles.collapsible}>
      <button
        type="button"
        className={headerClassName ? `${styles.header} ${headerClassName}` : styles.header}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={styles.headerContent}>{header}</span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}
        />
      </button>
      {open ? (
        <div className={bodyClassName ? `${styles.body} ${bodyClassName}` : styles.body}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
