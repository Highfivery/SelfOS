import { describe, expect, it } from 'vitest';
import { normalizeCategories } from './categories';

describe('normalizeCategories', () => {
  it('keeps known life-areas (case-insensitive), de-dupes, and caps at 2', () => {
    expect(normalizeCategories(['relationships', 'RELATIONSHIPS', 'family', 'money'])).toEqual([
      'Relationships',
      'Family',
    ]);
  });

  it('drops unknown areas and falls back to Other when nothing valid remains', () => {
    expect(normalizeCategories(['nonsense', 'whatever'])).toEqual(['Other']);
    expect(normalizeCategories([])).toEqual(['Other']);
  });
});
