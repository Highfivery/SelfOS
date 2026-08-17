import { describe, expect, it } from 'vitest';

import { DIRTY_TALK } from './instruments/dirtyTalk';

import { applyBankMarks, applyDirections, emptyLexicon } from './lexicon';
import { DIRTY_TALK_SPINE, scoreSpine } from './spine';

const NOW = new Date('2026-08-16T12:00:00.000Z');

function score(marks: Record<string, 'love' | 'never' | 'okay'>, splits = {}): Map<string, number> {
  let lex = applyBankMarks(emptyLexicon('p1', NOW), DIRTY_TALK.bank, marks, 'take:1', NOW);
  lex = applyDirections(lex, splits, NOW);
  return new Map(scoreSpine(lex).map((s) => [s.key, s.normalized]));
}

describe('the spine (74 §4.2)', () => {
  it('is fixed — every dimension has a stable key, so trends survive a retake', () => {
    const keys = DIRTY_TALK_SPINE.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith('dirtytalk.')).toBe(true);
  });

  it('scores every dimension for an empty lexicon without throwing', () => {
    const scores = scoreSpine(emptyLexicon('p1', NOW));
    expect(scores).toHaveLength(DIRTY_TALK_SPINE.length);
    for (const s of scores) {
      expect(s.normalized).toBe(0);
      expect(s.band).toBeTruthy();
    }
  });

  it('OMITS unmarked entries rather than counting them as zero', () => {
    // One loved praise entry and nothing else marked → praise reads high, not 1/900th of high. This is the
    // whole reason the two-pass bank works: unrated means "not marked", never "not interested" (74 §3.2).
    const scores = score({ 'praise-her:you-re-beautiful': 'love' });
    expect(scores.get('dirtytalk.praise')).toBeGreaterThan(0.7);
  });

  it('reads a boundary as a genuine zero, not a missing answer', () => {
    const scores = score({
      'names-rough-heavy:whore': 'never',
      'degradation:beg-like-the-slut-you-are': 'never',
    });
    expect(scores.get('dirtytalk.degradation')).toBe(0);
  });

  it('separates claiming from degradation — the distinction the whole test exists to find', () => {
    const scores = score({
      'claiming:you-re-mine': 'love',
      'names-praise:good-girl': 'love',
      'degradation:beg-like-the-slut-you-are': 'never',
      'names-rough-heavy:whore': 'never',
    });
    expect(scores.get('dirtytalk.claiming')).toBeGreaterThan(0.7);
    expect(scores.get('dirtytalk.degradation')).toBe(0);
  });

  it('measures explicitness by the TIER of what they loved, not how much they marked', () => {
    const tame = score({ 'demands-receiving:touch-me': 'love' }); // tier 1
    const filthy = score({ 'demands-receiving:wreck-my-pussy': 'love' }); // tier 5
    expect(tame.get('dirtytalk.explicitness')).toBe(0);
    expect(filthy.get('dirtytalk.explicitness')).toBe(1);
  });

  it('measures say-confidence as the gap between wanting to hear it and being able to say it', () => {
    const wantsAll = score(
      { 'names-praise:good-girl': 'love', 'anatomy-her:cunt': 'love' },
      { 'names-praise:good-girl': { hear: 4, say: 4 }, 'anatomy-her:cunt': { hear: 4, say: 4 } },
    );
    const frozen = score(
      { 'names-praise:good-girl': 'love', 'anatomy-her:cunt': 'love' },
      { 'names-praise:good-girl': { hear: 4, say: 0 }, 'anatomy-her:cunt': { hear: 4, say: 0 } },
    );
    expect(wantsAll.get('dirtytalk.say-confidence')).toBe(1);
    expect(frozen.get('dirtytalk.say-confidence')).toBe(0);
  });

  it('reads the giving and receiving voices from the SAY direction, not the max', () => {
    // She loves hearing the receiving-voice demands but cannot say them: the voice score must read LOW.
    const scores = score(
      { 'demands-receiving:fuck-me': 'love' },
      { 'demands-receiving:fuck-me': { hear: 4, say: 0 } },
    );
    expect(scores.get('dirtytalk.receiving-voice')).toBe(0);
  });

  it('clamps every dimension into 0..1', () => {
    const scores = scoreSpine(
      applyBankMarks(
        emptyLexicon('p1', NOW),
        DIRTY_TALK.bank,
        Object.fromEntries(DIRTY_TALK.bank.entries.map((e) => [e.key, 'love' as const])),
        'take:1',
        NOW,
      ),
    );
    for (const s of scores) {
      expect(s.normalized).toBeGreaterThanOrEqual(0);
      expect(s.normalized).toBeLessThanOrEqual(1);
    }
  });
});

describe('honesty (74 §3.3)', () => {
  it('says "nothing yet" for a dimension nothing was marked for — never "not their thing"', () => {
    const lex = applyBankMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { 'praise-her:you-re-beautiful': 'love' },
      'take:1',
      NOW,
    );
    const scores = new Map(scoreSpine(lex).map((s) => [s.key, s.band]));
    // Praise was actually marked, so it reads as a real result…
    expect(scores.get('dirtytalk.praise')).not.toBe('nothing yet');
    // …while degradation, which they were never asked about in this take, says so.
    expect(scores.get('dirtytalk.degradation')).toBe('nothing yet');
  });

  it('reads a marked-as-NEVER dimension as a genuine zero, not as silence', () => {
    const lex = applyBankMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { 'names-rough-heavy:whore': 'never' },
      'take:1',
      NOW,
    );
    const scores = new Map(scoreSpine(lex).map((s) => [s.key, s.band]));
    expect(scores.get('dirtytalk.degradation')).toBe('not their thing');
  });
});
