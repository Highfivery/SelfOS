import { useEffect, useState } from 'react';
import { ChevronDown, FolderOpen, Info, Lock, TriangleAlert, Users } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { TitlebarControl } from '../design-system/components';
import { AboutSelfOsDialog } from './AboutSelfOsDialog';
import styles from './AccountMenu.module.css';

/** Two-letter initials from a display name (first + last word), for the avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase() || '?';
}

/**
 * The titlebar account control: avatar + active person's name. Opening it reveals the session menu —
 * switch person and lock (logout).
 */
export function AccountMenu({
  onSwitch,
  conflicts = [],
}: {
  onSwitch: () => void;
  /** Sync-conflict copies found in the vault — surfaced in the menu's "Open vault folder" item. */
  conflicts?: string[];
}): JSX.Element | null {
  const activePerson = useSessionStore((s) => s.activePerson);
  const lock = useSessionStore((s) => s.lock);
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const conflictCount = conflicts.length;
  const hasConflicts = conflictCount > 0;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!activePerson) return null;
  const name = activePerson.displayName;

  return (
    <div className={styles.wrap}>
      <TitlebarControl
        className={styles.trigger}
        tone={hasConflicts ? 'warning' : 'default'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          hasConflicts
            ? `Signed in as ${name} — ${conflictCount} sync ${conflictCount === 1 ? 'conflict' : 'conflicts'}`
            : `Signed in as ${name}`
        }
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(name)}
        </span>
        <span className={styles.name}>{name}</span>
        {hasConflicts ? <TriangleAlert size={14} aria-hidden="true" /> : null}
        <ChevronDown size={14} aria-hidden="true" />
      </TitlebarControl>
      {open ? (
        <>
          <button
            type="button"
            className={styles.backdrop}
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className={styles.menu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                onSwitch();
              }}
            >
              <Users size={16} aria-hidden="true" />
              Switch person
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                lock();
              }}
            >
              <Lock size={16} aria-hidden="true" />
              Lock
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                void window.selfos?.revealVault();
              }}
            >
              {hasConflicts ? (
                <TriangleAlert size={16} aria-hidden="true" />
              ) : (
                <FolderOpen size={16} aria-hidden="true" />
              )}
              {hasConflicts
                ? `Resolve ${conflictCount} sync ${conflictCount === 1 ? 'conflict' : 'conflicts'}`
                : 'Open vault folder'}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
            >
              <Info size={16} aria-hidden="true" />
              About SelfOS
            </button>
          </div>
        </>
      ) : null}
      {aboutOpen ? <AboutSelfOsDialog onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
