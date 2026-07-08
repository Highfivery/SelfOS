import styles from './Questionnaires.module.css';

/** Initials from a display name: first + last initial, or the first two letters of a single-word name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase() || '?';
  const last = parts[parts.length - 1] ?? '';
  // charAt returns '' (never undefined) out of range — no non-null assertions needed (CLAUDE.md §4).
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/**
 * A small initials avatar for a recipient / sender chip (redesigned Questionnaires landing, 08 §3.1).
 * Decorative — the name is always shown as text beside it — so it's `aria-hidden`. Uses the accent-subtle
 * tint (not a per-person hue) so contrast holds in both light and dark themes.
 */
export function Avatar({ name }: { name: string }): JSX.Element {
  return (
    <span className={styles.av} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
