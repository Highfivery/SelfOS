import type { NewMaterialEntry } from '@shared/schemas';

/** One chapter's pending drift, gathered for the "Needs you" strip (72 §4.4). */
export interface DriftCard {
  chapterId: string;
  title: string;
  /** What the person reads: how much new material, and/or what they changed. */
  lines: string[];
  /** Whether any of it is genuinely NEW MATERIAL (vs only the author's own changes) — the two read
   *  differently: one is an offer, the other is a consequence of something they did. */
  hasMaterial: boolean;
}
/**
 * Group the drift entries by chapter into the cards the strip renders. Pure, so the wording is testable
 * without a DOM. A chapter that has since been deleted from the outline drops out silently.
 */
export function driftCards(
  entries: NewMaterialEntry[],
  chapters: { id: string; title: string }[],
): DriftCard[] {
  const titleById = new Map(chapters.map((c) => [c.id, c.title]));
  const byChapter = new Map<string, NewMaterialEntry[]>();
  for (const entry of entries) {
    const list = byChapter.get(entry.chapterId) ?? [];
    list.push(entry);
    byChapter.set(entry.chapterId, list);
  }
  const cards: DriftCard[] = [];
  for (const [chapterId, list] of byChapter) {
    const title = titleById.get(chapterId);
    if (title === undefined) continue;
    const lines: string[] = [];
    let hasMaterial = false;
    for (const entry of list) {
      if (entry.reason === 'newMaterial') {
        hasMaterial = true;
        const n = entry.items.length;
        lines.push(
          n === 0
            ? 'Something it draws on has changed.'
            : `${n} new detail${n === 1 ? '' : 's'} could go in.`,
        );
      } else if (entry.note) {
        lines.push(entry.note);
      }
    }
    if (lines.length > 0) cards.push({ chapterId, title, lines, hasMaterial });
  }
  return cards;
}
