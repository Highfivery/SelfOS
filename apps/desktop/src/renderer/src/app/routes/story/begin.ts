import type { BookConfig, BookTypeId, StoryCorpusStats } from '@selfos/core/schemas';
import { getBookType } from '@selfos/core/story';

/**
 * The "Drawn from" chips for the invitation (§13.3) — a deterministic, human read of how much material the
 * biographer will draw from. Only non-zero counts appear; the year span (when known) reads as a range or a
 * single year. Pure, so it's unit-testable without a DOM.
 */
export function drawnFromChips(stats: StoryCorpusStats): string[] {
  const chips: string[] = [];
  const n = (count: number, one: string, many: string): void => {
    if (count > 0) chips.push(`${count} ${count === 1 ? one : many}`);
  };
  n(stats.conversations, 'session', 'sessions');
  n(stats.reflections, 'reflection', 'reflections');
  n(stats.dreams, 'dream', 'dreams');
  if (stats.yearFrom && stats.yearTo) {
    chips.push(
      stats.yearFrom === stats.yearTo ? `${stats.yearFrom}` : `${stats.yearFrom}–${stats.yearTo}`,
    );
  }
  return chips;
}

/**
 * The specimen sentence for the commission's live preview (§13.3): "how your biographer will sound", chosen by
 * the picked style × voice from the BookType's static style presets. Falls back to an empty string if the type
 * or style isn't found (the preview just hides). Pure.
 */
export function specimenFor(
  bookTypeId: BookTypeId,
  config: Pick<BookConfig, 'style' | 'voice'>,
): string {
  const bookType = getBookType(bookTypeId);
  const preset = bookType?.stylePresets.find((p) => p.id === config.style);
  if (!preset) return '';
  return config.voice === 'first' ? preset.specimen.first : preset.specimen.third;
}
