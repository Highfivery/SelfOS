import { useEffect, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { TitlebarControl } from '../design-system/components';
import { AppearanceMenu } from './AppearanceMenu';
import { AccountMenu } from './AccountMenu';
import { Brand } from './Brand';
import { SyncStatusChip } from './SyncStatusChip';
import { UsageRing } from './UsageRing';
import styles from './AppHeader.module.css';

interface AppHeaderProps {
  /** Sync-conflict copies found in the vault (drives the sync status chip). */
  conflicts: string[];
  /** Open the "Who's here?" person switcher (from the account menu). */
  onSwitchPerson: () => void;
  /** Open the mobile nav drawer (the hamburger, shown below `--bp-md`). */
  onOpenNav: () => void;
  /** Whether the mobile nav drawer is open (drives the hamburger's `aria-expanded`). */
  navOpen: boolean;
  /** Ref to the hamburger so focus can return to it when the drawer closes. */
  hamburgerRef: RefObject<HTMLButtonElement>;
}

/**
 * The integrated, window-spanning titlebar (02-app-shell §13.2): the brand at the left (after the
 * platform's window-control zone), the global controls at the right, and a draggable middle. It
 * replaces the old in-content TopBar strip + the sidebar brand header, so the brand and the global
 * controls finally live in one cohesive bar and there's no macOS brand-vs-traffic-lights collision.
 *
 * Per-platform window chrome is set in `main/window.ts`; the renderer reserves the matching inset from
 * the `platform` flag (macOS traffic lights at the left, Windows min/max/close at the right). On
 * macOS the lights hide in fullscreen, so the brand reclaims their inset.
 */
export function AppHeader({
  conflicts,
  onSwitchPerson,
  onOpenNav,
  navOpen,
  hamburgerRef,
}: AppHeaderProps): JSX.Element {
  const platform = window.selfos?.platform ?? 'unknown';
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => window.selfos?.onFullscreenChanged(setFullscreen), []);

  return (
    <header className={styles.header} data-platform={platform} data-fullscreen={fullscreen}>
      {/* Reserves the macOS traffic-light cluster so the brand never overlaps it (0-width elsewhere). */}
      <span className={styles.leadInset} aria-hidden="true" />
      <span className={styles.navSlot}>
        <TitlebarControl
          ref={hamburgerRef}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={onOpenNav}
        >
          <Menu size={20} aria-hidden="true" />
        </TitlebarControl>
      </span>
      <Link to="/" className={styles.brandLink} aria-label="SelfOS" title="Home">
        <Brand />
      </Link>
      <div className={styles.items}>
        {/* The sync chip collapses first at the narrowest widths (the in-content Banner still shows
            conflicts); keeps the essential controls + the macOS traffic-light inset within view. */}
        <span className={styles.syncSlot}>
          <SyncStatusChip conflicts={conflicts} />
        </span>
        <UsageRing />
        <AppearanceMenu />
        <AccountMenu onSwitch={onSwitchPerson} />
      </div>
    </header>
  );
}
