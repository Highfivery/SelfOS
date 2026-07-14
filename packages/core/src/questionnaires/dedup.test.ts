import { describe, expect, it } from 'vitest';
import { isNearDuplicate, jaccard, normalizePrompt, tokenSet } from './dedup';

describe('near-duplicate detection (08 §23.5)', () => {
  it('normalizes case, punctuation, and whitespace', () => {
    expect(normalizePrompt("What's your   favorite FOOD?!")).toBe('what s your favorite food');
  });

  it('treats an exact re-ask (only punctuation/case differs) as a duplicate', () => {
    expect(isNearDuplicate('What is your favorite food?', ['what is your favorite food'])).toBe(
      true,
    );
  });

  it('catches a close paraphrase (shared topic words); stays conservative at the default threshold', () => {
    // "handle stress at work" vs "cope with stress at work" shares 2 of 4 content words (Jaccard 0.5). A tuned
    // threshold catches it; the DEFAULT (0.6) is deliberately conservative — it stays out, so the fuzzy layer
    // rarely false-drops and the SEMANTIC pass (§23.5 layer 3) catches the meaning-only paraphrases.
    const pair = ['How do you cope with stress at work?'];
    expect(isNearDuplicate('How do you handle stress at work?', pair, 0.5)).toBe(true);
    expect(isNearDuplicate('How do you handle stress at work?', pair)).toBe(false);
  });

  it('catches subset containment (a paraphrase that only adds scaffolding)', () => {
    expect(
      isNearDuplicate('your favorite weekend activity', [
        'what would you say is your favorite weekend activity these days',
      ]),
    ).toBe(true);
  });

  it('keeps a genuinely different question that shares only a filler word', () => {
    expect(
      isNearDuplicate('How do you handle conflict at work?', ['What is your favorite food?']),
    ).toBe(false);
  });

  it('does NOT hard-drop on a single shared content word (that is the semantic pass’s job)', () => {
    // "family" is a subset of the longer prompt's tokens, but a one-word overlap is not a duplicate — these
    // ask different things, so the conservative fuzzy layer keeps it (size-1 containment is gated off).
    expect(
      isNearDuplicate("What's your family like?", [
        'What activities does your family enjoy together?',
      ]),
    ).toBe(false);
  });

  it('an empty/whitespace candidate is never a duplicate', () => {
    expect(isNearDuplicate('   ', ['anything'])).toBe(false);
  });

  it('jaccard of disjoint sets is 0 and identical sets is 1', () => {
    expect(jaccard(tokenSet('apples oranges'), tokenSet('cars trucks'))).toBe(0);
    expect(jaccard(tokenSet('quiet mornings'), tokenSet('mornings quiet'))).toBe(1);
  });
});
