import { useEffect, type ReactNode } from 'react';
import { useSettingsStore } from '../settings/settingsStore';
import { resolveTheme, type Appearance } from '../design-system/theme';

/**
 * Applies the appearance settings to `<html>` (theme, density, text scale, reduced motion) and keeps
 * the theme in sync with the OS when set to "system". The settings store is the source of truth;
 * before it loads, defaults apply (system theme), so there's no jarring flash.
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const theme = useSettingsStore((s) => s.values['appearance.theme'] as Appearance | undefined);
  const density = useSettingsStore((s) => s.values['appearance.density'] as string | undefined);
  const textScale = useSettingsStore((s) => s.values['appearance.textScale'] as number | undefined);
  const reduceMotion = useSettingsStore(
    (s) => s.values['appearance.reduceMotion'] as boolean | undefined,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const root = document.documentElement;
      root.setAttribute('data-theme', resolveTheme(theme ?? 'system', media.matches));
      root.setAttribute('data-density', density ?? 'comfortable');
      root.style.setProperty('--type-scale', String(textScale ?? 1));
      root.setAttribute('data-reduce-motion', reduceMotion ? 'true' : 'false');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, density, textScale, reduceMotion]);

  return <>{children}</>;
}
