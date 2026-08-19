import { describe, expect, it } from 'vitest';
import type { TestSummary } from '@selfos/core/tests';
import type { TestResult } from '@shared/schemas';
import {
  cardStateOf,
  filterCount,
  filterTests,
  hubStats,
  nextForYou,
  testsOutstandingCount,
} from './testsHub';

const NOW = Date.parse('2026-08-18T12:00:00Z');
const daysAgo = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function summary(over: Partial<TestSummary> & Pick<TestSummary, 'id'>): TestSummary {
  return {
    group: 'personality',
    title: over.id,
    instrument: 'X',
    blurb: 'A blurb.',
    framing: 'A reflection, not a verdict.',
    estimatedMinutes: 10,
    itemCount: 20,
    adult: false,
    sensitive: false,
    subscales: [],
    wellbeing: false,
    ...over,
  };
}

function result(testId: string, takenAt: string): TestResult {
  return {
    id: `${testId}-${takenAt}`,
    schemaVersion: 1,
    testId,
    testVersion: 1,
    subjectPersonId: 'p1',
    answers: [],
    scores: [],
    takenAt,
    createdAt: takenAt,
    updatedAt: takenAt,
  };
}

const bigFive = summary({ id: 'bigfive-ipip-120', estimatedMinutes: 20 });
const gad7 = summary({ id: 'gad7', group: 'wellbeing', wellbeing: true, estimatedMinutes: 2 });
const phq9 = summary({ id: 'phq9', group: 'wellbeing', wellbeing: true, estimatedMinutes: 3 });
const aq10 = summary({ id: 'aq10', group: 'wellbeing', wellbeing: true, estimatedMinutes: 3 });
const dirtyTalk = summary({
  id: 'dirty-talk',
  kind: 'adaptive',
  group: 'intimacy',
  adult: true,
  sensitive: true,
  estimatedMinutes: 15,
});

describe('cardStateOf', () => {
  it('is untaken with no results, taken with a fresh one', () => {
    expect(cardStateOf(phq9, [], NOW)).toBe('untaken');
    expect(cardStateOf(phq9, [result('phq9', daysAgo(2))], NOW)).toBe('taken');
  });

  it('goes due once a recheckable check-in passes the gentle window', () => {
    expect(cardStateOf(phq9, [result('phq9', daysAgo(13))], NOW)).toBe('taken');
    expect(cardStateOf(phq9, [result('phq9', daysAgo(14))], NOW)).toBe('due');
    expect(cardStateOf(gad7, [result('gad7', daysAgo(40))], NOW)).toBe('due');
  });

  it('never goes due for an instrument outside the recheckable pair', () => {
    // A wellbeing reflection that is not mood/anxiety is a one-off, not a recurring check-in — nagging
    // someone to re-take an 80-item autism reflection every fortnight would be wrong.
    expect(cardStateOf(aq10, [result('aq10', daysAgo(400))], NOW)).toBe('taken');
    // And a personality test never expires at all.
    expect(cardStateOf(bigFive, [result('bigfive-ipip-120', daysAgo(400))], NOW)).toBe('taken');
  });
});

describe('hubStats + testsOutstandingCount', () => {
  const catalog = [bigFive, phq9, gad7, dirtyTalk];
  const results = {
    'bigfive-ipip-120': [result('bigfive-ipip-120', daysAgo(90))],
    phq9: [result('phq9', daysAgo(30))], // due
    gad7: [],
    'dirty-talk': [],
  };

  it('counts a due instrument as taken, not as a separate bucket', () => {
    const stats = hubStats(catalog, results, NOW);
    expect(stats).toEqual({ taken: 2, notTried: 2, due: 1 });
    // The whole catalog is accounted for exactly once.
    expect(stats.taken + stats.notTried).toBe(catalog.length);
  });

  it('counts outstanding as never-taken plus due', () => {
    expect(testsOutstandingCount(catalog, results, NOW)).toBe(3);
  });

  it('is zero — so no badge at all — once everything is taken and nothing is due', () => {
    const done = {
      'bigfive-ipip-120': [result('bigfive-ipip-120', daysAgo(90))],
      phq9: [result('phq9', daysAgo(1))],
      gad7: [result('gad7', daysAgo(1))],
      'dirty-talk': [result('dirty-talk', daysAgo(5))],
    };
    expect(testsOutstandingCount(catalog, done, NOW)).toBe(0);
  });

  it('grows rather than completing when a new instrument ships', () => {
    // The catalog is not a finite set to finish — an added instrument simply raises "not tried".
    const withNew = [...catalog, summary({ id: 'brand-new' })];
    expect(testsOutstandingCount(withNew, results, NOW)).toBe(4);
  });
});

describe('nextForYou', () => {
  it('leads with an overdue check-in over the flagship', () => {
    const next = nextForYou([dirtyTalk, phq9], { phq9: [result('phq9', daysAgo(18))] }, NOW);
    expect(next?.test.id).toBe('phq9');
    expect(next?.reason).toBe('due');
    expect(next?.lastAt).toBe(daysAgo(18));
  });

  it('picks the check-in left longest when several are due', () => {
    const next = nextForYou(
      [phq9, gad7],
      { phq9: [result('phq9', daysAgo(20))], gad7: [result('gad7', daysAgo(60))] },
      NOW,
    );
    expect(next?.test.id).toBe('gad7');
  });

  it('falls to the adaptive flagship when nothing is due', () => {
    const next = nextForYou([bigFive, dirtyTalk, gad7], {}, NOW);
    expect(next?.test.id).toBe('dirty-talk');
    expect(next?.reason).toBe('flagship');
  });

  it('falls to the shortest untried once the flagship is started', () => {
    const next = nextForYou(
      [bigFive, dirtyTalk, gad7],
      { 'dirty-talk': [result('dirty-talk', daysAgo(3))] },
      NOW,
    );
    expect(next?.test.id).toBe('gad7'); // 2 min beats Big Five's 20
    expect(next?.reason).toBe('quick');
  });

  it('falls to the shortest untried pre-ack, when the flagship is withheld by the bridge', () => {
    // Before the 18+ acknowledgement the adult instruments are not in the catalog at ALL, so no
    // special-casing is needed here — but the slot must still offer something.
    const next = nextForYou([bigFive, gad7], {}, NOW);
    expect(next?.test.id).toBe('gad7');
    expect(next?.reason).toBe('quick');
  });

  it('offers nothing when everything is taken and nothing is due', () => {
    const next = nextForYou(
      [bigFive, gad7],
      {
        'bigfive-ipip-120': [result('bigfive-ipip-120', daysAgo(9))],
        gad7: [result('gad7', daysAgo(1))],
      },
      NOW,
    );
    expect(next).toBeUndefined();
  });
});

describe('filters', () => {
  const catalog = [bigFive, phq9, gad7, dirtyTalk];
  const results = { 'bigfive-ipip-120': [result('bigfive-ipip-120', daysAgo(3))] };

  it('narrows by status and by area from one control', () => {
    expect(filterTests(catalog, results, NOW, 'all')).toHaveLength(4);
    expect(filterTests(catalog, results, NOW, 'untaken').map((t) => t.id)).toEqual([
      'phq9',
      'gad7',
      'dirty-talk',
    ]);
    expect(filterTests(catalog, results, NOW, 'quick').map((t) => t.id)).toEqual(['phq9', 'gad7']);
    expect(filterTests(catalog, results, NOW, 'intimacy').map((t) => t.id)).toEqual(['dirty-talk']);
  });

  it('counts what each filter would show, so a chip is never a dead end', () => {
    expect(filterCount(catalog, results, NOW, 'all')).toBe(4);
    expect(filterCount(catalog, results, NOW, 'untaken')).toBe(3);
    expect(filterCount(catalog, results, NOW, 'wellbeing')).toBe(2);
  });
});
