import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useSetting } from '../settings/useSetting';
import type { Appearance } from '../design-system/theme';
import styles from './AppearanceMenu.module.css';

const SYSTEM: { value: Appearance; label: string; icon: LucideIcon } = {
  value: 'system',
  label: 'System',
  icon: Monitor,
};
const OPTIONS: ReadonlyArray<{ value: Appearance; label: string; icon: LucideIcon }> = [
  SYSTEM,
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * Compact appearance control for the TopBar (02-app-shell §3.5): a single icon button showing the
 * active theme, opening a popover with System / Light / Dark — mirroring the usage-ring and account
 * menus so it reads as a native top-bar control and conserves horizontal space.
 */
export function AppearanceMenu(): JSX.Element {
  const [theme, setTheme] = useSetting('appearance.theme');
  const [open, setOpen] = useState(false);
  const current = OPTIONS.find((option) => option.value === theme) ?? SYSTEM;
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Appearance: ${current.label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CurrentIcon size={18} aria-hidden="true" />
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
          <div className={styles.menu} role="menu" aria-label="Appearance">
            {OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = option.value === theme;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
                  onClick={() => {
                    setTheme(option.value);
                    setOpen(false);
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  {option.label}
                  {active ? <Check size={14} className={styles.check} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
