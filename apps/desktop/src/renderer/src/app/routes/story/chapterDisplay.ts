import styles from './Story.module.css';

export const PART_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
export function partLabel(index: number): string {
  return `Part ${PART_WORDS[index] ?? index + 1}`;
}
/** The status pill on a chapter card: reviewed → done, generating/stale → in-progress, else new/updated. */
export function chapterBadge(status: string): { label: string; cls: string } {
  if (status === 'reviewed') return { label: 'Reviewed', cls: styles.chBadgeDone ?? '' };
  if (status === 'generating') return { label: 'Writing…', cls: styles.chBadgeWip ?? '' };
  if (status === 'stale') return { label: 'New material', cls: styles.chBadgeWip ?? '' };
  if (status === 'updated') return { label: 'Updated', cls: '' };
  return { label: 'New', cls: '' };
}
/** A deterministic background crop per card, so cover-backed cards (which all share the one cover) aren't
 *  pixel-identical. A chapter's own illustration is centered instead (it's already unique). */
export function coverPosition(seed: number): string {
  const x = 25 + ((seed * 37) % 50);
  const y = 30 + ((seed * 53) % 45);
  return `${x}% ${y}%`;
}
