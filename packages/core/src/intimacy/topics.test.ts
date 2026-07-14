import { describe, expect, it } from 'vitest';
import {
  INTIMACY_ACTIVITIES,
  INTIMACY_ACTIVITIES_FULL,
  INTIMACY_ACTIVITY_LABELS,
  INTIMACY_CATEGORIES,
  INTIMACY_CATEGORY_LABELS,
  INTIMACY_FANTASIES,
  categoryForKey,
  intimacyActivitiesByCategory,
  mergedIntimacyTopics,
  orderedActivities,
} from './topics';
import {
  buildGenerationUserMessage,
  GENERATION_SYSTEM,
  relationshipFraming,
} from '../questionnaires/aiPrompts';

describe('INTIMACY_ACTIVITIES_FULL — inventory integrity (49 §10)', () => {
  it('every entry key is unique (a duplicate would collide matrix ratings)', () => {
    const keys = INTIMACY_ACTIVITIES_FULL.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry has a valid category, a tier in 1..5, and a non-empty label', () => {
    for (const entry of INTIMACY_ACTIVITIES_FULL) {
      expect(INTIMACY_CATEGORIES, entry.label).toContain(entry.category);
      expect(entry.tier, entry.label).toBeGreaterThanOrEqual(1);
      expect(entry.tier, entry.label).toBeLessThanOrEqual(5);
      expect(entry.label.trim().length, entry.key).toBeGreaterThan(0);
    }
  });

  it('carries the 2026-06-26 additions in the right categories and dedups the blindfold entry', () => {
    const byLabel = new Map(INTIMACY_ACTIVITIES_FULL.map((a) => [a.label, a]));
    const added: [string, string][] = [
      ['Watch partner masturbate', 'sensual'],
      ['Thrusting machine', 'manual-toys'],
      ['Teasing penetration', 'penetration'],
      ['Wearing lingerie', 'roleplay'],
      ['Partner wearing lingerie', 'roleplay'],
      ['Pussy patting/slapping', 'impact'],
    ];
    for (const [label, category] of added) {
      expect(byLabel.get(label)?.category, label).toBe(category);
    }
    // Dedup: the blindfold-only entry is gone; exactly one 'Blindfolds' remains.
    expect(byLabel.has('Sensory deprivation (blindfold-only)')).toBe(false);
    expect(INTIMACY_ACTIVITIES_FULL.filter((a) => a.label === 'Blindfolds')).toHaveLength(1);
  });

  it('INTIMACY_CATEGORY_LABELS has an entry for EVERY category (exhaustive)', () => {
    for (const category of INTIMACY_CATEGORIES) {
      expect(INTIMACY_CATEGORY_LABELS[category]?.length).toBeGreaterThan(0);
    }
    expect(Object.keys(INTIMACY_CATEGORY_LABELS).sort()).toEqual([...INTIMACY_CATEGORIES].sort());
  });

  it('the flat label list equals the inventory labels and has no duplicates', () => {
    expect(INTIMACY_ACTIVITY_LABELS).toEqual(INTIMACY_ACTIVITIES_FULL.map((a) => a.label));
    expect(new Set(INTIMACY_ACTIVITY_LABELS).size).toBe(INTIMACY_ACTIVITY_LABELS.length);
    // INTIMACY_ACTIVITIES (the name questionnaire generation reads) is the same flat label list.
    expect(INTIMACY_ACTIVITIES).toEqual(INTIMACY_ACTIVITY_LABELS);
  });

  it('the inventory is in the agreed ~60–100 band and spans all 14 categories', () => {
    expect(INTIMACY_ACTIVITIES_FULL.length).toBeGreaterThanOrEqual(60);
    expect(INTIMACY_ACTIVITIES_FULL.length).toBeLessThanOrEqual(100);
    const usedCategories = new Set(INTIMACY_ACTIVITIES_FULL.map((a) => a.category));
    for (const category of INTIMACY_CATEGORIES)
      expect(usedCategories, category).toContain(category);
  });

  it('the two anatomy-resolved oral entries carry the 46 stable keys', () => {
    const oral = INTIMACY_ACTIVITIES_FULL.filter((a) => a.category === 'oral').map((a) => a.key);
    expect(oral).toContain('oral-receiving');
    expect(oral).toContain('oral-giving');
  });

  it('the two relationship dynamics are folded in as power-exchange entries with their preserved slugs', () => {
    const power = INTIMACY_ACTIVITIES_FULL.filter((a) => a.category === 'power-exchange');
    expect(power.map((a) => a.key)).toEqual(
      expect.arrayContaining(['degradation-humiliation', 'praise-worship']),
    );
  });

  it('every taboo-fantasy entry reads as fantasy/roleplay — no minors/illegal phrasing (the boundary, §8)', () => {
    const forbidden = /\b(minor|minors|child|children|teen|teenage|underage|kid|incest|bestial)/i;
    const taboo = INTIMACY_ACTIVITIES_FULL.filter((a) => a.category === 'taboo-fantasy');
    expect(taboo.length).toBeGreaterThan(0);
    for (const entry of taboo) {
      expect(entry.label, entry.label).not.toMatch(forbidden);
      // Each taboo entry is unambiguously framed as play/roleplay/fantasy/pre-agreed.
      expect(entry.label, entry.label).toMatch(/roleplay|role-play|play|fantasy|pre-agreed/i);
    }
  });
});

describe('category lookup + grouping accessors (49 §5)', () => {
  it('categoryForKey resolves an inventory key, the anatomy oral keys, and an unknown key', () => {
    expect(categoryForKey('fingering')).toBe('manual-toys');
    expect(categoryForKey('degradation-humiliation')).toBe('power-exchange');
    // The anatomy-resolved oral keys (never literal inventory entries) all group under `oral`.
    expect(categoryForKey('oral-giving-penis')).toBe('oral');
    expect(categoryForKey('oral-giving-vulva')).toBe('oral');
    expect(categoryForKey('oral-receiving')).toBe('oral');
    expect(categoryForKey('a-custom-owner-activity')).toBeUndefined();
  });

  it('intimacyActivitiesByCategory groups every entry; group order = INTIMACY_CATEGORIES; tier ascending', () => {
    const grouped = intimacyActivitiesByCategory();
    expect([...grouped.keys()]).toEqual([...INTIMACY_CATEGORIES]);
    let total = 0;
    for (const [category, entries] of grouped) {
      for (const entry of entries) expect(entry.category).toBe(category);
      const tiers = entries.map((e) => e.tier);
      expect(tiers, category).toEqual([...tiers].sort((a, b) => a - b)); // tier ascending within a group
      total += entries.length;
    }
    expect(total).toBe(INTIMACY_ACTIVITIES_FULL.length);
  });

  it('orderedActivities is category order, then tier within a category (sensual→extreme)', () => {
    const ordered = orderedActivities();
    expect(ordered.length).toBe(INTIMACY_ACTIVITIES_FULL.length);
    // Category index is non-decreasing across the whole ordered list.
    const catIndex = (c: (typeof ordered)[number]['category']) => INTIMACY_CATEGORIES.indexOf(c);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (!prev || !cur) continue;
      expect(catIndex(cur.category)).toBeGreaterThanOrEqual(catIndex(prev.category));
      if (cur.category === prev.category) expect(cur.tier).toBeGreaterThanOrEqual(prev.tier);
    }
    // The first entry is in the gentlest category, the last in the most intense.
    expect(ordered[0]?.category).toBe('sensual');
    expect(ordered[ordered.length - 1]?.category).toBe('taboo-fantasy');
  });
});

describe('INTIMACY_TOPICS (08 §16.5a) — generation still reads a flat label list (49 §3.2/§4.2)', () => {
  it('the built-in inventory is non-empty and excludes the UI "Other" escape', () => {
    expect(INTIMACY_ACTIVITIES.length).toBeGreaterThan(10);
    expect(INTIMACY_FANTASIES.length).toBeGreaterThan(5);
    expect(INTIMACY_ACTIVITIES).not.toContain('Other');
    expect(INTIMACY_FANTASIES).not.toContain('Other');
  });

  it('mergedIntimacyTopics appends the owner custom additions, deduped case-insensitively (built-ins win)', () => {
    const merged = mergedIntimacyTopics({
      activities: ['Sploshing', 'fingering', '  '], // one new, one dupe of a built-in, one blank
      fantasies: ['Pirate roleplay'],
    });
    expect(merged.activities).toContain('Sploshing');
    expect(merged.fantasies).toContain('Pirate roleplay');
    // The case-insensitive duplicate of a built-in is dropped (no second "Fingering").
    expect(merged.activities.filter((a) => a.toLowerCase() === 'fingering')).toHaveLength(1);
    expect(merged.activities).not.toContain('  ');
  });

  it('with no custom additions, the merged inventory is exactly the built-ins', () => {
    const merged = mergedIntimacyTopics();
    expect(merged.activities).toEqual([...INTIMACY_ACTIVITIES]);
    expect(merged.fantasies).toEqual([...INTIMACY_FANTASIES]);
  });
});

describe('tier-distinct explicit generation framing (08 §16.5/§22.2)', () => {
  const base = {
    brief: 'our sex life',
    context: '',
    existingPrompts: [],
    count: 5,
    intimacyTopics: mergedIntimacyTopics(),
  };

  it('intimacy + unfiltered is the MOST graphic tier, seeds the inventory, states the boundary', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
    });
    expect(msg).toMatch(/no-holds-barred/i); // the unfiltered directive
    expect(msg).toMatch(/blunt, plain/i);
    expect(msg).toContain('Deepthroat'); // a seeded activity (current inventory label)
    expect(msg).toContain('Consensual non-consent (CNC) roleplay'); // a seeded fantasy
    // The legitimate-context + consensual-adult boundary is stated in-prompt.
    expect(msg).toMatch(/appropriate and expected/i);
    expect(msg).toMatch(/consensual adults only/i);
    expect(msg).toMatch(/never minors/i);
  });

  it('intimacy + explicit is frank and specific but a deliberate step back from unfiltered', () => {
    const explicit = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'explicit',
    });
    expect(explicit).toMatch(/frank, specific questions/i);
    expect(explicit).toMatch(/step back from the most graphic/i);
    expect(explicit).not.toMatch(/no-holds-barred/i); // that's the unfiltered tier
    expect(explicit).toContain('Deepthroat'); // still seeds the inventory
  });

  it('explicit and unfiltered produce GENUINELY different directives (the intensity ladder)', () => {
    const explicit = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'explicit',
    });
    const unfiltered = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
    });
    expect(explicit).not.toEqual(unfiltered);
    // The unfiltered-only escalation phrase must not appear in explicit, and vice-versa.
    expect(unfiltered).toMatch(/hold nothing back short of the boundary/i);
    expect(explicit).not.toMatch(/hold nothing back short of the boundary/i);
  });

  it('intimacy + general is richer than a cliché but stays non-graphic (no inventory)', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'intimacyGeneral',
    });
    expect(msg).toMatch(/gentle tier/i);
    expect(msg).toMatch(/non-graphic/i);
    expect(msg).toMatch(/what turns them on/i); // the richer directive
    expect(msg).not.toMatch(/no-holds-barred/i);
    expect(msg).not.toContain('Deepthroat'); // the graphic inventory is NOT dumped into the gentle tier
  });

  it('SCENARIO + unfiltered gets the explicit framing, shaped as situations to react to (§22.2)', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'scenario',
      sensitivity: 'unfiltered',
    });
    expect(msg).toMatch(/no-holds-barred/i); // scenario now escalates too
    expect(msg).toMatch(/SITUATION or roleplay/); // shaped as scenarios, not direct questions
    expect(msg).toContain('Deepthroat'); // seeds the inventory
    expect(msg).toMatch(/never minors/i); // same boundary
  });

  it('SCENARIO + explicit is a deliberate step back from unfiltered', () => {
    const msg = buildGenerationUserMessage({ ...base, type: 'scenario', sensitivity: 'explicit' });
    expect(msg).toMatch(/step back from the most graphic/i);
    expect(msg).not.toMatch(/no-holds-barred/i);
  });

  it('a type that carries NO sensitivity tier does NOT get the explicit framing', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'role-feedback',
      sensitivity: 'unfiltered',
    });
    expect(msg).not.toMatch(/no-holds-barred/i);
    expect(msg).not.toContain('Deepthroat');
  });

  it('intimacy generate mode directs scenarios / mix / questions (§17.12-C)', () => {
    const scenarios = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
      intimacyMode: 'scenarios',
    });
    expect(scenarios).toMatch(/FORMAT — SCENARIOS/);
    expect(scenarios).toMatch(/described situation/i);

    const mix = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
      intimacyMode: 'mix',
    });
    expect(mix).toMatch(/FORMAT — MIX/);

    // The default (questions) adds no format direction; a NON-intimacy type ignores the mode entirely.
    const questions = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
      intimacyMode: 'questions',
    });
    expect(questions).not.toMatch(/FORMAT —/);
    const nonIntimacy = buildGenerationUserMessage({
      ...base,
      type: 'role-feedback',
      sensitivity: 'standard',
      intimacyMode: 'scenarios',
    });
    expect(nonIntimacy).not.toMatch(/FORMAT —/);
  });
});

describe('brief-as-focus + non-escalating contract (08 §23.3/§23.5)', () => {
  const base = {
    context: '',
    existingPrompts: [],
    count: 5,
    intimacyTopics: mergedIntimacyTopics(),
  };

  it('a present brief becomes a leading, governing FOCUS block', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'general',
      sensitivity: 'standard',
      brief: 'how we are handling the move',
    });
    expect(msg).toMatch(/FOCUS — this entire questionnaire is about: how we are handling the move/);
    expect(msg).toMatch(/Every question must serve this focus/);
    // It LEADS: the focus appears before any context/tailoring guidance.
    expect(msg.indexOf('FOCUS —')).toBeLessThan(msg.indexOf('Return the JSON object'));
    // The old un-emphasized brief line is gone.
    expect(msg).not.toMatch(/What they want to explore/);
  });

  it('a blank brief emits no FOCUS block (falls back to pre-§23 behaviour)', () => {
    const msg = buildGenerationUserMessage({ ...base, type: 'general', sensitivity: 'standard' });
    expect(msg).not.toMatch(/FOCUS —/);
    expect(msg).not.toMatch(/What they want to explore/);
  });

  it('the recipient-history contract no longer escalates "edgier every time" (§23.5)', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'general',
      sensitivity: 'standard',
      recipientHistory: 'Themes they have already explored:\n- Burnout at work.',
    });
    // The escalation framing is removed…
    expect(msg).not.toMatch(/edgier or more revealing territory/i);
    expect(msg).not.toMatch(/Push gently further than last time/i);
    // …replaced with a useful-not-novelty directive; the other de-dup directives stay.
    expect(msg).toMatch(/not novelty or edginess for its own sake/i);
    expect(msg).toMatch(/GO DEEPER/);
    expect(msg).toMatch(/UNKNOWN/);
    expect(msg).toMatch(/CREATIVE/);
  });

  it('an intimacy explicit draft WITH a focus keeps the register but follows the focus subject (§23.3)', () => {
    const focused = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
      brief: 'reconnecting after the baby',
    });
    expect(focused).toMatch(/SHAPE every question around the FOCUS/i);
    expect(focused).toMatch(/no-holds-barred/i); // the explicit register is unchanged
    // Without a focus, the shaping line is absent (the whole inventory drives it, as before).
    const unfocused = buildGenerationUserMessage({
      ...base,
      type: 'intimacy',
      sensitivity: 'unfiltered',
    });
    expect(unfocused).not.toMatch(/SHAPE every question around the FOCUS/i);
  });
});

describe('deep personalization + question intelligence (08 §24.4)', () => {
  const base = {
    context: '',
    existingPrompts: [],
    count: 5,
    intimacyTopics: mergedIntimacyTopics(),
  };

  it('relationshipFraming differs by type and modulates by closeness', () => {
    expect(relationshipFraming('partner')).toMatch(/PARTNER/);
    expect(relationshipFraming('coworker')).toMatch(/COWORKER/);
    expect(relationshipFraming('child')).toMatch(/CHILD/);
    // A coworker questionnaire is explicitly boundaried; a partner one is not.
    expect(relationshipFraming('coworker')).toMatch(/professional|boundaried/i);
    expect(relationshipFraming('partner')).not.toMatch(/do NOT ask intrusive/i);
    // Closeness modulates depth.
    expect(relationshipFraming('friend', 5)).toMatch(/very close/i);
    expect(relationshipFraming('friend', 1)).toMatch(/not especially close/i);
    expect(relationshipFraming('friend')).not.toMatch(/close/i);
  });

  it('buildGenerationUserMessage frames the recipient by name/pronouns + relationship register', () => {
    const msg = buildGenerationUserMessage({
      ...base,
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: {
        name: 'Angel',
        pronouns: 'she/her',
        relationship: { type: 'partner', closeness: 5 },
      },
    });
    expect(msg).toMatch(/FOR Angel \(she\/her\)/);
    expect(msg).toMatch(/use their pronouns/i);
    expect(msg).toMatch(/PARTNER/);
    expect(msg).toMatch(/very close/i);
  });

  it('GENERATION_SYSTEM carries the tailor-to-them, set-arc, and answer-type-intent directives', () => {
    expect(GENERATION_SYSTEM).toMatch(/TAILOR TO WHO THEY ARE/);
    expect(GENERATION_SYSTEM).toMatch(/PERSONALITY shape HOW you ask/); // psych-profile-aware
    expect(GENERATION_SYSTEM).toMatch(/COHERENT SET/); // the arc
    expect(GENERATION_SYSTEM).toMatch(/open with lighter.*deepen.*close/is);
    expect(GENERATION_SYSTEM).toMatch(
      /MATCH the answer type to what the question is trying to learn/,
    );
    expect(GENERATION_SYSTEM).toMatch(/never stack many rating scales/i);
  });
});
