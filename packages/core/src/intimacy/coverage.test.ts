import { describe, expect, it } from 'vitest';
import type { CoveredAct } from '../intake/intakeService';
import {
  buildIntimacyCoverage,
  categoriesMentionedIn,
  DORMANT_DAYS,
  nextIntimacyCategory,
  SATURATION_ASKS,
  type IntimacyCoverageInput,
} from './coverage';
import { INTIMACY_ACTIVITIES_FULL, INTIMACY_CATEGORIES } from './topics';

const NOW = new Date('2026-07-22T12:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function act(key: string, label = key, rating = 'Love it'): CoveredAct {
  return { key, label, rating };
}

function input(over: Partial<IntimacyCoverageInput> = {}): IntimacyCoverageInput {
  return { coveredActs: [], askedIntimacy: [], now: NOW, ...over };
}

/** Ask a category N times by feeding N prompts that each mention it. */
function asked(text: string, times: number, at?: string) {
  return Array.from({ length: times }, () => ({ text, ...(at ? { at } : {}) }));
}

describe('categoriesMentionedIn — keyword matching (08 §27.2)', () => {
  it('resolves the reported topics from natural prompt text', () => {
    expect(categoriesMentionedIn('What do you enjoy most about receiving oral?')).toContain('oral');
    expect(categoriesMentionedIn('How do you feel about anal these days?')).toContain('anal');
  });

  it('matches whole words only, so it does not fire on a coincidental substring', () => {
    // "anal" must not match "analyse"/"analysis" — the classic substring trap.
    expect(categoriesMentionedIn('Can you analyse how that felt?')).not.toContain('anal');
  });

  it('returns nothing for text with no intimacy signal', () => {
    expect(categoriesMentionedIn('What did you have for lunch?')).toEqual([]);
    expect(categoriesMentionedIn('')).toEqual([]);
  });

  it('NO category is a dead zone — each has at least one inventory act that credits it', () => {
    // Keyword spotting in free-text is best-effort (a missing keyword only UNDER-counts — the docstring's
    // fail-safe property), so it does NOT promise to match every act variant ("Vibrators" vs the "vibrator"
    // keyword). But every category must be reachable by SOMETHING in its own inventory, or that whole area can
    // never be marked worked-through and would repeat forever — the #314 failure mode. This is the real
    // invariant over the actual inventory, replacing the earlier single hand-picked probe per category.
    const reachable = new Set<string>();
    for (const act of INTIMACY_ACTIVITIES_FULL) {
      for (const c of categoriesMentionedIn(act.label)) reachable.add(c);
    }
    for (const category of INTIMACY_CATEGORIES) {
      expect(reachable.has(category)).toBe(true);
    }
  });

  it('an unrelated everyday phrase never credits a category (no false positives)', () => {
    for (const text of [
      'What did you have for lunch?',
      'How was work today?',
      'Tell me about your week',
      'What are you grateful for?',
    ]) {
      expect(categoriesMentionedIn(text)).toEqual([]);
    }
  });
});

describe('buildIntimacyCoverage — classification (08 §27.2)', () => {
  it('starts every category uncovered for a brand-new person', () => {
    const cov = buildIntimacyCoverage(input());
    expect(cov.uncovered).toHaveLength(INTIMACY_CATEGORIES.length);
    expect(cov.open).toEqual([]);
    expect(cov.saturated).toEqual([]);
  });

  it('a rated act makes its category open (not uncovered) via the STABLE key', () => {
    // 'oral-receiving' is the anatomy-resolved row whose display label varies — the key is the only
    // reliable path to its category, which is why CoveredAct carries it.
    const cov = buildIntimacyCoverage(
      input({ coveredActs: [act('oral-receiving', 'Receiving oral (blowjob)')] }),
    );
    expect(cov.open).toContain('oral');
    expect(cov.uncovered).not.toContain('oral');
    expect(cov.byCategory.find((c) => c.category === 'oral')?.rated).toBe(true);
  });

  it('saturates a category once it has been asked SATURATION_ASKS times', () => {
    const cov = buildIntimacyCoverage(
      input({ askedIntimacy: asked('Tell me more about anal', SATURATION_ASKS, daysAgo(2)) }),
    );
    expect(cov.saturated).toContain('anal');
    expect(cov.open).not.toContain('anal');
    expect(cov.uncovered).not.toContain('anal');
  });

  it('stays open one ask short of saturation', () => {
    const cov = buildIntimacyCoverage(
      input({ askedIntimacy: asked('Tell me more about anal', SATURATION_ASKS - 1, daysAgo(2)) }),
    );
    expect(cov.saturated).not.toContain('anal');
    expect(cov.open).toContain('anal');
  });

  it('drops a saturated category from deepenableActs — the #314 fix', () => {
    // The bug: every rated act was re-mined forever. A saturated category's acts must stop being offered
    // for "go deeper", while a non-saturated one keeps them.
    const cov = buildIntimacyCoverage(
      input({
        coveredActs: [act('oral-receiving', 'Receiving oral'), act('anal-receiving', 'Anal')],
        askedIntimacy: asked('More about receiving oral', SATURATION_ASKS, daysAgo(2)),
      }),
    );
    expect(cov.saturated).toContain('oral');
    expect(cov.deepenableActs.map((a) => a.key)).not.toContain('oral-receiving');
    expect(cov.deepenableActs.map((a) => a.key)).toContain('anal-receiving');
  });
});

describe('buildIntimacyCoverage — the four re-open signals (08 §27.4)', () => {
  const saturatingAsks = asked('More about anal', SATURATION_ASKS, daysAgo(30));

  it('new material since the last ask re-opens it', () => {
    const cov = buildIntimacyCoverage(
      input({ askedIntimacy: saturatingAsks, newMaterialAt: daysAgo(1) }),
    );
    expect(cov.saturated).not.toContain('anal');
    expect(cov.byCategory.find((c) => c.category === 'anal')?.reopenedBy).toBe('new-material');
  });

  it('a profile/onboarding edit since the last ask re-opens it', () => {
    const cov = buildIntimacyCoverage(
      input({ askedIntimacy: saturatingAsks, profileEditedAt: daysAgo(1) }),
    );
    expect(cov.byCategory.find((c) => c.category === 'anal')?.reopenedBy).toBe('profile-edit');
  });

  it('an explicit exploration focus naming the ground re-opens it', () => {
    const cov = buildIntimacyCoverage(
      input({ askedIntimacy: saturatingAsks, explicitFocus: 'I want to talk about anal more' }),
    );
    expect(cov.byCategory.find((c) => c.category === 'anal')?.reopenedBy).toBe('explicit-request');
  });

  it('dormancy re-opens it after DORMANT_DAYS', () => {
    const cov = buildIntimacyCoverage(
      input({
        askedIntimacy: asked('More about anal', SATURATION_ASKS, daysAgo(DORMANT_DAYS + 1)),
      }),
    );
    expect(cov.byCategory.find((c) => c.category === 'anal')?.reopenedBy).toBe('dormant');
  });

  it('stale material BEFORE the last ask does not re-open it', () => {
    // Only material newer than the last ask is genuinely new ground.
    const cov = buildIntimacyCoverage(
      input({ askedIntimacy: saturatingAsks, newMaterialAt: daysAgo(60) }),
    );
    expect(cov.saturated).toContain('anal');
    expect(cov.byCategory.find((c) => c.category === 'anal')?.reopenedBy).toBeUndefined();
  });

  it('survives malformed timestamps without throwing', () => {
    const cov = buildIntimacyCoverage(
      input({
        askedIntimacy: [{ text: 'anal', at: 'not-a-date' }],
        newMaterialAt: 'also-not-a-date',
      }),
    );
    expect(cov.byCategory).toHaveLength(INTIMACY_CATEGORIES.length);
  });
});

describe('nextIntimacyCategory — where the next check-in goes (08 §27.3)', () => {
  it('prefers uncovered ground', () => {
    const cov = buildIntimacyCoverage(input({ coveredActs: [act('oral-receiving')] }));
    const next = nextIntimacyCategory(cov);
    expect(next).toBeDefined();
    expect(cov.uncovered).toContain(next);
    expect(next).not.toBe('oral');
  });

  it('falls back to the least-worked open category when nothing is uncovered', () => {
    // Every category rated → nothing uncovered; the one asked least should come next.
    const coveredActs = [act('oral-receiving'), act('anal-receiving')];
    const cov = buildIntimacyCoverage(
      input({
        coveredActs,
        askedIntimacy: [{ text: 'More about receiving oral', at: daysAgo(1) }],
      }),
    );
    const uncoveredNext = nextIntimacyCategory(cov);
    // Uncovered ground still exists here (12 other categories), so it must NOT return a worked one.
    expect(cov.saturated).toEqual([]);
    expect(uncoveredNext).toBeDefined();
    expect(['oral']).not.toContain(uncoveredNext);
  });

  it('leads with the MOST intense uncovered ground on the unfiltered tier (08 §27.3)', () => {
    // INTIMACY_CATEGORIES is ascending intensity, so an unordered lead hands `unfiltered` the four gentlest
    // areas while its directive demands "go beyond vanilla" — the tame-output tension. Tier ordering fixes it.
    const cov = buildIntimacyCoverage(input());
    const gentleFirst = nextIntimacyCategory(cov, 'explicit');
    const intenseFirst = nextIntimacyCategory(cov, 'unfiltered');
    expect(gentleFirst).toBe(INTIMACY_CATEGORIES[0]);
    expect(intenseFirst).toBe(INTIMACY_CATEGORIES[INTIMACY_CATEGORIES.length - 1]);
    expect(intenseFirst).not.toBe(gentleFirst);
  });

  it('returns undefined only when every category is saturated', () => {
    const askedIntimacy = INTIMACY_CATEGORIES.flatMap((c) =>
      asked(categoryProbe(c), SATURATION_ASKS, daysAgo(1)),
    );
    const cov = buildIntimacyCoverage(input({ askedIntimacy }));
    expect(cov.saturated).toHaveLength(INTIMACY_CATEGORIES.length);
    expect(nextIntimacyCategory(cov)).toBeUndefined();
  });
});

/** A phrase guaranteed to match exactly one category — used to saturate every category in a test. */
function categoryProbe(category: string): string {
  const probes: Record<string, string> = {
    sensual: 'sensual massage',
    oral: 'receiving oral',
    'manual-toys': 'vibrator',
    penetration: 'penetration',
    anal: 'anal',
    roleplay: 'roleplay',
    'dirty-talk': 'dirty talk',
    'power-exchange': 'submissive',
    bondage: 'bondage',
    impact: 'spanking',
    exhibition: 'voyeurism',
    group: 'threesome',
    edge: 'breath play',
    'taboo-fantasy': 'primal play',
  };
  return probes[category] ?? category;
}
