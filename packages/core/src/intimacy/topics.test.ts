import { describe, expect, it } from 'vitest';
import { INTIMACY_ACTIVITIES, INTIMACY_FANTASIES, mergedIntimacyTopics } from './topics';
import { buildGenerationUserMessage } from '../questionnaires/aiPrompts';

describe('INTIMACY_TOPICS (08 §16.5a)', () => {
  it('the built-in inventory is non-empty and excludes the UI "Other" escape', () => {
    expect(INTIMACY_ACTIVITIES.length).toBeGreaterThan(10);
    expect(INTIMACY_FANTASIES.length).toBeGreaterThan(5);
    expect(INTIMACY_ACTIVITIES).not.toContain('Other');
    expect(INTIMACY_FANTASIES).not.toContain('Other');
  });

  it('mergedIntimacyTopics appends the owner custom additions, deduped case-insensitively (built-ins win)', () => {
    const merged = mergedIntimacyTopics({
      activities: ['Wax play', 'oral (giving)', '  '], // one new, one dupe of a built-in, one blank
      fantasies: ['Pirate roleplay'],
    });
    expect(merged.activities).toContain('Wax play');
    expect(merged.fantasies).toContain('Pirate roleplay');
    // The case-insensitive duplicate of a built-in is dropped (no second "Oral (giving)").
    expect(merged.activities.filter((a) => a.toLowerCase() === 'oral (giving)')).toHaveLength(1);
    expect(merged.activities).not.toContain('  ');
  });

  it('with no custom additions, the merged inventory is exactly the built-ins', () => {
    const merged = mergedIntimacyTopics();
    expect(merged.activities).toEqual([...INTIMACY_ACTIVITIES]);
    expect(merged.fantasies).toEqual([...INTIMACY_FANTASIES]);
  });
});

describe('tier-distinct explicit generation framing (08 §16.5)', () => {
  const base = {
    brief: 'our sex life',
    context: '',
    existingPrompts: [],
    count: 5,
    intimacyTopics: mergedIntimacyTopics(),
  };

  it('intimacy + unfiltered requests genuinely explicit content, seeds the inventory, and is most graphic', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
    });
    expect(msg).toMatch(/genuinely explicit/i);
    expect(msg).toMatch(/frank, plain language/i); // the unfiltered intensity
    expect(msg).toContain('Oral (giving)'); // a seeded activity
    expect(msg).toContain('Consensual non-consent (CNC) roleplay'); // a seeded fantasy
    // The legitimate-context + consensual-adult boundary is stated in-prompt.
    expect(msg).toMatch(/appropriate and expected/i);
    expect(msg).toMatch(/consensual adults only/i);
    expect(msg).toMatch(/never minors/i);
  });

  it('intimacy + explicit is explicit but a notch gentler than unfiltered', () => {
    const explicit = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'explicit',
    });
    expect(explicit).toMatch(/genuinely explicit/i);
    expect(explicit).toMatch(/a notch gentler/i);
    expect(explicit).not.toMatch(/frank, plain language/i); // that's the unfiltered intensity
  });

  it('intimacy + general stays respectful with nothing explicit', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'intimacyGeneral',
    });
    expect(msg).not.toMatch(/genuinely explicit/i);
    expect(msg).toMatch(/nothing explicit/i);
  });

  it('a NON-intimacy type at an explicit tier does NOT get the explicit framing', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'role-feedback',
      sensitivity: 'unfiltered',
    });
    expect(msg).not.toMatch(/genuinely explicit/i);
    expect(msg).not.toContain('Oral (giving)');
  });
});
