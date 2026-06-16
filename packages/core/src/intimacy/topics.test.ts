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

  it('intimacy + unfiltered frames a sexual-wellness instrument, seeds the inventory, and is most candid (§17.2)', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
    });
    expect(msg).toMatch(/sexual-wellness questionnaire/i); // the in-policy wellness frame
    expect(msg).toMatch(/fully candid and specific/i); // the unfiltered depth
    expect(msg).toContain('Oral (giving)'); // a seeded activity
    expect(msg).toContain('Consensual non-consent (CNC) roleplay'); // a seeded fantasy
    // The health register + consensual-adult boundary is stated in-prompt.
    expect(msg).toMatch(/sexual-health intake|intimacy worksheet/i);
    expect(msg).toMatch(/not as erotica/i);
    expect(msg).toMatch(/consenting adults only/i);
    expect(msg).toMatch(/never minors/i);
  });

  it('intimacy + explicit is candid but a notch gentler than unfiltered (§17.2)', () => {
    const explicit = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'explicit',
    });
    expect(explicit).toMatch(/sexual-wellness questionnaire/i);
    expect(explicit).toMatch(/a notch gentler than fully unfiltered/i);
    expect(explicit).not.toMatch(/fully candid and specific/i); // that's the unfiltered depth
  });

  it('intimacy + general stays respectful with nothing explicit', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'intimacyGeneral',
    });
    expect(msg).not.toMatch(/sexual-wellness questionnaire/i);
    expect(msg).toMatch(/nothing explicit/i);
  });

  it('a NON-intimacy type at an explicit tier does NOT get the wellness framing', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'role-feedback',
      sensitivity: 'unfiltered',
    });
    expect(msg).not.toMatch(/sexual-wellness questionnaire/i);
    expect(msg).not.toContain('Oral (giving)');
  });
});
