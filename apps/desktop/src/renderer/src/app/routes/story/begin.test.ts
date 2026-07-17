import { describe, expect, it } from 'vitest';
import { drawnFromChips, specimenFor } from './begin';

describe('drawnFromChips (§13.3)', () => {
  it('shows only non-zero counts, pluralized, plus a year range', () => {
    expect(
      drawnFromChips({ conversations: 3, reflections: 1, dreams: 0, yearFrom: 2019, yearTo: 2026 }),
    ).toEqual(['3 sessions', '1 reflection', '2019–2026']);
  });

  it('collapses a single-year span to one year and omits zero counts', () => {
    expect(
      drawnFromChips({ conversations: 1, reflections: 0, dreams: 2, yearFrom: 2026, yearTo: 2026 }),
    ).toEqual(['1 session', '2 dreams', '2026']);
  });

  it('is empty when there is nothing on record', () => {
    expect(drawnFromChips({ conversations: 0, reflections: 0, dreams: 0 })).toEqual([]);
  });

  it('omits the year chip when no span is known', () => {
    expect(drawnFromChips({ conversations: 2, reflections: 0, dreams: 0 })).toEqual(['2 sessions']);
  });
});

describe('specimenFor (§13.3)', () => {
  it('returns a first-person specimen for the first voice and third-person otherwise', () => {
    const first = specimenFor('biography', { style: 'warm', voice: 'first' });
    const third = specimenFor('biography', { style: 'warm', voice: 'third' });
    expect(first).not.toBe(third);
    expect(first.length).toBeGreaterThan(0);
    expect(third.length).toBeGreaterThan(0);
    // The first-person specimen speaks as "I"; the third-person does not.
    expect(first.startsWith('I ')).toBe(true);
    expect(third.startsWith('I ')).toBe(false);
  });

  it('changes with the chosen style', () => {
    const warm = specimenFor('biography', { style: 'warm', voice: 'third' });
    const cinematic = specimenFor('biography', { style: 'cinematic', voice: 'third' });
    expect(warm).not.toBe(cinematic);
  });
});
