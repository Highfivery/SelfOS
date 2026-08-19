import { describe, expect, it } from 'vitest';
import type { AdaptiveNameEntryView, AdaptiveNameRegisterView } from '@shared/schemas';
import { intensityRange, registerStats, sortRegisters, EMPTY_STATS } from './registerStats';

const entry = (key: string, family: string, tier = 2): AdaptiveNameEntryView => ({
  key,
  text: key,
  family,
  tier,
  example: `come here, ${key}`,
});

const ENTRIES = [
  entry('a', 'warm'),
  entry('b', 'warm'),
  entry('c', 'warm'),
  entry('d', 'rough', 5),
];

const reg = (
  id: string,
  count: number,
  minTier: number,
  maxTier: number,
): AdaptiveNameRegisterView => ({
  id,
  label: `Names — ${id}`,
  count,
  minTier,
  maxTier,
  samples: [],
});

describe('registerStats (74 §3.6.8)', () => {
  it('counts a name once it is marked in EITHER direction — the owner’s call', () => {
    const stats = registerStats(ENTRIES, { a: { hear: 'love' }, b: { say: 'okay' } });
    expect(stats.warm).toMatchObject({ marked: 2, love: 1, okay: 1, never: 0 });
  });

  it('puts a mixed name in exactly one bucket, so the counts sum to the marked total', () => {
    // Loved to hear, ruled out to say. A no is the most decision-relevant thing on the card, so it wins.
    const stats = registerStats(ENTRIES, { a: { hear: 'love', say: 'never' } });
    expect(stats.warm).toMatchObject({ marked: 1, love: 0, never: 1 });
    const { love, okay, never, marked } = stats.warm!;
    expect(love + okay + never).toBe(marked);
  });

  it('ignores a key with no marks left on it, so un-marking really does decrement', () => {
    expect(registerStats(ENTRIES, { a: {} }).warm).toMatchObject({ marked: 0 });
  });

  it('scopes each register to its own names', () => {
    const stats = registerStats(ENTRIES, { a: { hear: 'love' }, d: { hear: 'never' } });
    expect(stats.warm?.marked).toBe(1);
    expect(stats.rough).toMatchObject({ marked: 1, never: 1 });
  });
});

describe('the range, said in words rather than a meter', () => {
  it('names a single band, and spells out a span', () => {
    expect(intensityRange(1, 2)).toBe('gentle');
    expect(intensityRange(5, 5)).toBe('intense');
    expect(intensityRange(2, 4)).toBe('gentle to strong');
    expect(intensityRange(1, 5)).toBe('gentle to intense');
  });
});

describe('sorting the grid', () => {
  const REGISTERS = [reg('warm', 3, 1, 2), reg('rough', 1, 4, 5), reg('mid', 2, 2, 3)];

  it('leads with in progress, then untouched, then all-marked', () => {
    const stats = {
      warm: { ...EMPTY_STATS, marked: 3 }, // finished
      rough: { ...EMPTY_STATS }, // untouched
      mid: { ...EMPTY_STATS, marked: 1 }, // in progress
    };
    expect(sortRegisters(REGISTERS, stats, 'state').map((r) => r.id)).toEqual([
      'mid',
      'rough',
      'warm',
    ]);
  });

  it('keeps the curated warm→furthest order as the tiebreak, and can sort by intensity', () => {
    expect(sortRegisters(REGISTERS, {}, 'warm').map((r) => r.id)).toEqual(['warm', 'rough', 'mid']);
    expect(sortRegisters(REGISTERS, {}, 'hot').map((r) => r.id)).toEqual(['rough', 'mid', 'warm']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...REGISTERS];
    sortRegisters(input, {}, 'az');
    expect(input.map((r) => r.id)).toEqual(['warm', 'rough', 'mid']);
  });
});
