import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import type { Appearance } from '../design-system/theme';
import styles from './AppearanceToggle.module.css';

const OPTIONS: ReadonlyArray<{ value: Appearance; label: string; Icon: LucideIcon }> = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function AppearanceToggle(): JSX.Element {
  const { appearance, setAppearance } = useTheme();

  return (
    <div className={styles.group} role="group" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={value === appearance ? `${styles.button} ${styles.active}` : styles.button}
          aria-pressed={value === appearance}
          aria-label={label}
          title={label}
          onClick={() => setAppearance(value)}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
