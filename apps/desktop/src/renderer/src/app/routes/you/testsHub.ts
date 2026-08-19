import type { TestGroupId, TestSummary } from '@selfos/core/tests';
import type { TestResult } from '@shared/schemas';
import { RECHECK_AFTER_DAYS, RECHECKABLE_INSTRUMENTS, daysSince } from '../home/wellbeing';

/**
 * The Tests hub's pure derivations (50 §3.1). Everything the page renders and everything the nav badge
 * counts comes from here, so the two can never disagree — the bug class that made the Home card and the
 * Questionnaires badge drift apart before `navCounts.ts` centralized them.
 *
 * The catalog is a FINITE list of instruments, and taking one is a discrete act — so a COUNT of what is
 * outstanding is honest here. A ratio, a percentage or a meter is not: instruments keep being added, so
 * "10 of 10" would be a lie the next release, and an adaptive take (74) never finishes at all. Nothing in
 * this module returns a proportion for that reason.
 */

/** Below this, an instrument is "quick" — drives the "Under 5 min" filter and the lead slot's fallback. */
export const QUICK_MINUTES = 5;

/** What a card shows: an invitation, a result you own, or a result whose gentle re-check window has passed. */
export type TestCardState = 'untaken' | 'taken' | 'due';

/** The active person's takes for one instrument, newest first (the `testStore` contract). */
export function takesOf(
  resultsByTest: Record<string, TestResult[]>,
  test: TestSummary,
): TestResult[] {
  return resultsByTest[test.id] ?? [];
}

/**
 * A card's state. `due` is the 51 §3.4 gentle re-check window — it only ever applies to an instrument that
 * has ALREADY been checked in on (never an invitation to a first take), and only to the recheckable
 * mood/anxiety pair, reusing the exact rule the Home nudge uses so the two surfaces agree.
 */
export function cardStateOf(test: TestSummary, results: TestResult[], now: number): TestCardState {
  const latest = results[0];
  if (latest === undefined) return 'untaken';
  const recheckable = test.wellbeing && RECHECKABLE_INSTRUMENTS.has(test.id);
  if (recheckable && daysSince(latest.takenAt, now) >= RECHECK_AFTER_DAYS) return 'due';
  return 'taken';
}

export interface HubStats {
  /** Instruments with at least one take — INCLUDING the ones now due (a due check-in is still taken). */
  taken: number;
  /** Instruments never taken. `taken + notTried` is the whole catalog. */
  notTried: number;
  /** Taken instruments past their gentle re-check window. A subset of `taken`, not an extra bucket. */
  due: number;
}

export function hubStats(
  catalog: TestSummary[],
  resultsByTest: Record<string, TestResult[]>,
  now: number,
): HubStats {
  let taken = 0;
  let notTried = 0;
  let due = 0;
  for (const test of catalog) {
    const state = cardStateOf(test, takesOf(resultsByTest, test), now);
    if (state === 'untaken') notTried += 1;
    else {
      taken += 1;
      if (state === 'due') due += 1;
    }
  }
  return { taken, notTried, due };
}

/**
 * What the nav badge counts: never taken, plus anything past its gentle re-check window. Deliberately the
 * same arithmetic the stat strip shows, so the nav number and the page can't contradict each other.
 * Zero means no badge at all (the Inbox convention — never a "0" pill).
 */
export function testsOutstandingCount(
  catalog: TestSummary[],
  resultsByTest: Record<string, TestResult[]>,
  now: number,
): number {
  const { notTried, due } = hubStats(catalog, resultsByTest, now);
  return notTried + due;
}

/** Why the lead slot picked this instrument — drives its copy, never its styling alone. */
export type NextReason = 'due' | 'flagship' | 'quick';

export interface NextUp {
  test: TestSummary;
  reason: NextReason;
  /** For a `due` pick: when it was last checked in on, so the copy can say how long it's been. */
  lastAt?: string;
}

/**
 * The rotating "next for you" pick. A genuinely overdue check-in outranks everything — a two-minute
 * re-check that is two weeks late matters more than a fifteen-minute intimacy take. Failing that the
 * adaptive flagship leads (74), and failing that the shortest thing untried, because length is the real
 * barrier to starting.
 *
 * Returns `undefined` when everything is taken and nothing is due — the slot hides rather than inventing
 * something to push. Note the flagship is 18+-gated IN THE BRIDGE, so pre-ack it isn't in `catalog` at all
 * and this falls through to the shortest untaken with no special-casing needed here.
 */
export function nextForYou(
  catalog: TestSummary[],
  resultsByTest: Record<string, TestResult[]>,
  now: number,
): NextUp | undefined {
  const stateOf = (test: TestSummary): TestCardState =>
    cardStateOf(test, takesOf(resultsByTest, test), now);

  // 1. Due — the one left longest, so a backlog is worked oldest-first.
  const due = catalog
    .filter((test) => stateOf(test) === 'due')
    .map((test) => ({ test, at: takesOf(resultsByTest, test)[0]?.takenAt ?? '' }))
    // Parse rather than compare strings: a lexicographic sort is only correct while every stamp is `…Z`.
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const oldest = due[0];
  if (oldest !== undefined) {
    return { test: oldest.test, reason: 'due', ...(oldest.at !== '' ? { lastAt: oldest.at } : {}) };
  }

  // 2. The adaptive flagship, while it has never been started.
  const flagship = catalog.find((test) => test.kind === 'adaptive' && stateOf(test) === 'untaken');
  if (flagship !== undefined) return { test: flagship, reason: 'flagship' };

  // 3. The shortest untried. A stable sort, so equal lengths keep catalog order.
  const shortest = catalog
    .filter((test) => stateOf(test) === 'untaken')
    .sort((a, b) => a.estimatedMinutes - b.estimatedMinutes)[0];
  return shortest !== undefined ? { test: shortest, reason: 'quick' } : undefined;
}

/** The catalog filter. Status filters and area filters share one control — one "show me…" concept. */
export type HubFilter = 'all' | 'untaken' | 'quick' | TestGroupId;

export function matchesFilter(
  test: TestSummary,
  results: TestResult[],
  now: number,
  filter: HubFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'untaken':
      return cardStateOf(test, results, now) === 'untaken';
    case 'quick':
      return test.estimatedMinutes < QUICK_MINUTES;
    default:
      return test.group === filter;
  }
}

export function filterTests(
  catalog: TestSummary[],
  resultsByTest: Record<string, TestResult[]>,
  now: number,
  filter: HubFilter,
): TestSummary[] {
  return catalog.filter((test) => matchesFilter(test, takesOf(resultsByTest, test), now, filter));
}

/** How many instruments a filter would show — the count beside each chip, so its result is legible before
 *  you tap it (a zero-count filter is still tappable, and lands on the empty note). */
export function filterCount(
  catalog: TestSummary[],
  resultsByTest: Record<string, TestResult[]>,
  now: number,
  filter: HubFilter,
): number {
  return filterTests(catalog, resultsByTest, now, filter).length;
}
