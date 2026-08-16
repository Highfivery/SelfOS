import { describe, expect, it } from 'vitest';
import { BookStyleSchema, BookLengthSchema } from '@shared/schemas';
import { BOOK_TYPES } from '@selfos/core/books';
import { LENGTH_CARDS, STYLE_CHOICES, stylesForType } from './bookConfigOptions';

/**
 * Every card in the commission gallery carries a one-line hint, and a style that ships without one renders
 * as a bare title with empty space under it. That is exactly how Filthy talk, Playful, Aching and Hardcore
 * shipped: the presets were added to the book type, but the HINT lives in a separate list keyed by id, and
 * `stylesForType` falls back to `''` for an id it can't find — silently, with nothing to fail.
 */
describe('every choice explains itself', () => {
  it('gives every style a hint', () => {
    for (const style of BookStyleSchema.options) {
      const choice = STYLE_CHOICES.find((c) => c.value === style);
      expect(choice, `no STYLE_CHOICES entry for "${style}"`).toBeDefined();
      expect(choice?.hint.trim().length, `"${style}" has an empty hint`).toBeGreaterThan(0);
      expect(choice?.label.trim().length, `"${style}" has an empty label`).toBeGreaterThan(0);
    }
  });

  it('gives every length a card with a sublabel', () => {
    for (const length of BookLengthSchema.options) {
      const card = LENGTH_CARDS.find((c) => c.value === length);
      expect(card, `no LENGTH_CARDS entry for "${length}"`).toBeDefined();
      expect(card?.sub.trim().length, `"${length}" has an empty sublabel`).toBeGreaterThan(0);
    }
  });

  /** The real render path: what a type OFFERS must arrive with a hint attached, not just exist in the enum. */
  it('resolves a hint for every register each book type actually offers', () => {
    for (const type of BOOK_TYPES) {
      for (const choice of stylesForType(type.stylePresets)) {
        expect(
          choice.hint.trim().length,
          `${type.id} offers "${choice.value}" with no hint`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
