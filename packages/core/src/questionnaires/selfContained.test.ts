import { describe, expect, it } from 'vitest';
import { hasDanglingReference } from './selfContained';

describe('selfContained — hasDanglingReference (§25.4 backstop)', () => {
  it('flags an unambiguous back-reference to unseen context', () => {
    expect(hasDanglingReference('What does that worry you mentioned attach to?')).toBe(true);
    expect(hasDanglingReference('Tell me more about the goal you told me about.')).toBe(true);
    expect(hasDanglingReference('As we discussed, how did that land?')).toBe(true);
    expect(hasDanglingReference('As you put it, what changed?')).toBe(true);
    expect(hasDanglingReference('Building on your earlier answer, what next?')).toBe(true);
    expect(hasDanglingReference('You mentioned earlier — say more?')).toBe(true);
  });

  it('does NOT flag a self-contained question, even with "that"/"the" demonstratives', () => {
    // These are exactly the legitimate phrasings a naive "that <noun>" matcher would wreck — the
    // backstop must leave them alone (the prompt rule handles the demonstrative-dangle case).
    expect(hasDanglingReference('What is the thing that weighs on you most right now?')).toBe(
      false,
    );
    expect(hasDanglingReference('What is it that drives you?')).toBe(false);
    expect(hasDanglingReference('When a worry about your health shows up, what happens?')).toBe(
      false,
    );
    expect(hasDanglingReference('Have you ever mentioned this to anyone you trust?')).toBe(false);
    expect(
      hasDanglingReference('When you mention your needs to a partner, how do they respond?'),
    ).toBe(false);
    expect(hasDanglingReference('What would you say to your younger self?')).toBe(false);
  });
});
