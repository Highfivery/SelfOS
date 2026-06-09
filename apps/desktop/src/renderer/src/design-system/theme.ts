export type Appearance = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'selfos.appearance';

/** Resolve the concrete theme from the user's appearance preference and the OS dark-mode flag. */
export function resolveTheme(appearance: Appearance, prefersDark: boolean): ResolvedTheme {
  if (appearance === 'system') return prefersDark ? 'dark' : 'light';
  return appearance;
}

export function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}
