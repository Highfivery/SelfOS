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
import { buildGenerationUserMessage } from '../questionnaires/aiPrompts';

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
    expect(msg).toContain('Deepthroat'); // a seeded activity (current inventory label)
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
