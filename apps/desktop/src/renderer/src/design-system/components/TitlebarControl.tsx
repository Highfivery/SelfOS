import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './TitlebarControl.module.css';

interface TitlebarControlProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  /** `warning` recolors the control to signal an attention state (e.g. a sync conflict). */
  tone?: 'default' | 'warning';
  children: ReactNode;
}

/**
 * The shared titlebar control primitive (02-app-shell §13.3). Every control in the integrated
 * titlebar — the sync chip, the usage ring, the appearance menu, the account menu — renders through
 * this so they share one height (`--control-height`), hit area, radius, and hover/focus treatment and
 * line up exactly. It is always `no-drag` so clicks aren't swallowed by the titlebar's drag region.
 *
 * Compound controls (those with their own popover) keep their positioning wrapper and use this as the
 * trigger; `forwardRef` lets callers attach a ref (e.g. the mobile nav hamburger).
 */
export const TitlebarControl = forwardRef<HTMLButtonElement, TitlebarControlProps>(
  function TitlebarControl(
    { tone = 'default', type = 'button', className, children, ...rest },
    ref,
  ) {
    const cls = [styles.control, tone === 'warning' ? styles.warning : undefined, className]
      .filter(Boolean)
      .join(' ');
    return (
      <button ref={ref} type={type} className={cls} {...rest}>
        {children}
      </button>
    );
  },
);
