import { useEffect, useState } from 'react';
import { ChevronDown, Lock, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import styles from './AccountMenu.module.css';

/** Two-letter initials from a display name (first + last word), for the avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase() || '?';
}

/**
 * The TopBar account control: avatar + active person's name. Opening it reveals the session menu —
 * switch person, lock (logout), and, while the concealed super-admin is active, leave inspect mode.
 * A visible "Super-admin" badge marks the elevated state.
 */
export function AccountMenu({ onSwitch }: { onSwitch: () => void }): JSX.Element | null {
  const activePerson = useSessionStore((s) => s.activePerson);
  const superAdmin = useSessionStore((s) => s.superAdmin);
  const lock = useSessionStore((s) => s.lock);
  const lockSuperAdmin = useSessionStore((s) => s.lockSuperAdmin);
  const [open, setOpen] = useState(false);

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
      {superAdmin ? (
        <span className={styles.adminBadge}>
          <ShieldCheck size={13} aria-hidden="true" />
          Super-admin
        </span>
      ) : null}
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(name)}
        </span>
        <span className={styles.name}>{name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
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
            {superAdmin ? (
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  lockSuperAdmin();
                }}
              >
                <ShieldOff size={16} aria-hidden="true" />
                Lock inspect mode
              </button>
            ) : null}
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
          </div>
        </>
      ) : null}
    </div>
  );
}
