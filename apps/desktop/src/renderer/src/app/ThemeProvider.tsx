import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  isAppearance,
  resolveTheme,
  type Appearance,
} from '../design-system/theme';

interface ThemeContextValue {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearance(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Applies the resolved theme to `<html data-theme>` and keeps it in sync with the OS when the
 * appearance is `system`. Appearance is persisted locally; the real settings-backed version arrives
 * with the settings slice (spec 03).
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [appearance, setAppearanceState] = useState<Appearance>(readStoredAppearance);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const theme = resolveTheme(appearance, media.matches);
      document.documentElement.setAttribute('data-theme', theme);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; the in-memory preference still applies for this session.
    }
    setAppearanceState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ appearance, setAppearance }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
