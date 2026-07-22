import { describe, expect, it } from 'vitest';
import { drawnFromChips, specimenFor } from './begin';

describe('drawnFromChips (§13.3/§15.2)', () => {
  it('shows only non-zero counts, pluralized, plus a year range', () => {
    expect(
      drawnFromChips({
        reflections: 1,
        dreams: 0,
        memories: 2,
        answers: 3,
        yearFrom: 2019,
        yearTo: 2026,
      }),
    ).toEqual(['1 reflection', '2 memories', '3 answered questionnaires', '2019–2026']);
  });

  it('collapses a single-year span to one year and omits zero counts', () => {
    expect(
      drawnFromChips({
        reflections: 0,
        dreams: 2,
        memories: 0,
        answers: 1,
        yearFrom: 2026,
        yearTo: 2026,
      }),
    ).toEqual(['2 dreams', '1 answered questionnaire', '2026']);
  });

  it('is empty when there is nothing on record', () => {
    expect(drawnFromChips({ reflections: 0, dreams: 0, memories: 0, answers: 0 })).toEqual([]);
  });

  it('omits the year chip when no span is known', () => {
    expect(drawnFromChips({ reflections: 2, dreams: 0, memories: 0, answers: 0 })).toEqual([
      '2 reflections',
    ]);
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
