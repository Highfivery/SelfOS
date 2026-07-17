import { describe, expect, it } from 'vitest';
import { hasChanges, wordDiff } from './storyDiff';

describe('wordDiff (64 §13.5)', () => {
  it('identical text is all "same" and re-joins to the original', () => {
    const tokens = wordDiff('The garage smelled of pine.', 'The garage smelled of pine.');
    expect(tokens.every((t) => t.op === 'same')).toBe(true);
    expect(tokens.map((t) => t.text).join('')).toBe('The garage smelled of pine.');
    expect(hasChanges('The garage smelled of pine.', 'The garage smelled of pine.')).toBe(false);
  });

  it('an empty prior yields all-added (a first draft has nothing to remove)', () => {
    const tokens = wordDiff('', 'He learned to speak.');
    expect(tokens.every((t) => t.op === 'added')).toBe(true);
    expect(
      tokens
        .map((t) => t.text)
        .join('')
        .trim(),
    ).toBe('He learned to speak.');
  });

  it('a replaced word shows the removed old word and the added new word, keeping shared words', () => {
    const tokens = wordDiff('The garage smelled of pine.', 'The garage smelled of cedar.');
    // 'of' is shared; 'pine.' is removed; 'cedar.' is added.
    expect(tokens.filter((t) => t.op === 'removed').map((t) => t.text.trim())).toEqual(['pine.']);
    expect(tokens.filter((t) => t.op === 'added').map((t) => t.text.trim())).toEqual(['cedar.']);
    expect(tokens.filter((t) => t.op === 'same').map((t) => t.text.trim())).toEqual([
      'The',
      'garage',
      'smelled',
      'of',
    ]);
    expect(hasChanges('The garage smelled of pine.', 'The garage smelled of cedar.')).toBe(true);
  });

  it('an inserted phrase is added while the surrounding words stay same', () => {
    const tokens = wordDiff('He learned to speak.', 'He finally learned to speak up.');
    // 'speak.' → 'speak up.' registers as replacing 'speak.' with 'speak' + adding 'up.'.
    expect(tokens.filter((t) => t.op === 'added').map((t) => t.text.trim())).toEqual([
      'finally',
      'speak',
      'up.',
    ]);
    expect(tokens.filter((t) => t.op === 'removed').map((t) => t.text.trim())).toEqual(['speak.']);
    // The reconstructed "current" text (same + added tokens) reads correctly.
    expect(
      tokens
        .filter((t) => t.op !== 'removed')
        .map((t) => t.text)
        .join('')
        .trim(),
    ).toBe('He finally learned to speak up.');
  });

  it('pure whitespace differences are not treated as changes', () => {
    expect(hasChanges('The  garage', 'The garage')).toBe(false);
  });

  it('degrades to a coarse whole-block diff past the cell cap (never builds an unbounded table)', () => {
    // Two ~1001-word texts → n·m ≈ 1.0M > MAX_DIFF_CELLS → the coarse fallback (all old removed, all new added).
    const prev = Array.from({ length: 1001 }, (_, i) => `old${i}`).join(' ');
    const next = Array.from({ length: 1001 }, (_, i) => `new${i}`).join(' ');
    const tokens = wordDiff(prev, next);
    expect(tokens.filter((t) => t.op === 'removed')).toHaveLength(1001);
    expect(tokens.filter((t) => t.op === 'added')).toHaveLength(1001);
    expect(tokens.some((t) => t.op === 'same')).toBe(false);
    // Removed (old) precede added (new), so it reads as a full replacement.
    expect(tokens[0]?.op).toBe('removed');
    expect(tokens[tokens.length - 1]?.op).toBe('added');
  });
});
