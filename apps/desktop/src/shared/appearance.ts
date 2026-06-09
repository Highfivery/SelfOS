/**
 * Pre-paint window background colors. The main process can't read CSS variables before the renderer
 * paints, so it needs literal values here. These mirror the `--color-bg` design tokens in
 * 01-design-system (tokens.css) for light and dark — keep the two in sync intentionally.
 */
export const BACKGROUND_COLORS = {
  light: '#f6f1ea',
  dark: '#1c1a17',
} as const;
