import { NO_SIGNAL_BAND } from '@shared/schemas';
import type { TestSummary } from '@selfos/core/tests';
import type { TestSubscaleScore } from '@shared/schemas';
import { subscaleViews, topSubscales, type SubscaleView } from './profile';

/**
 * 50 §3.1 — what a TAKEN card says, chosen per instrument rather than one generic bar for all.
 *
 * A single "top 2 subscales as bars" summary is actively misleading on two of the instruments:
 *
 * - **Sexuality & orientation** is Kinsey + Klein, and Klein's whole purpose is where the seven variables
 *   DISAGREE. Ranking them by distance from neutral means that near a pole most land on the same value, so
 *   the card printed the same sentence twice — and a bipolar bar with no labelled ends can't be read at all.
 * - **Kink & intimacy interests** is 14 opt-in categories in 4 bands, so the top entries routinely share a
 *   band ("a strong draw" twice) and two-of-fourteen hides how much was actually explored.
 *
 * Everything here reads only subscales WITH SIGNAL: an unrated subscale floors to its minimum, and stating
 * that floor as a finding is the bug §8.1a fixes. Selection is by SHAPE, not by id, so a future instrument
 * of the same shape gets the right reading without being named here.
 */

export type ReadingKind = 'spectrum' | 'draws' | 'bars';

/** A scored subscale that actually had answers behind it. */
function withSignal(views: SubscaleView[]): SubscaleView[] {
  return views.filter((v) => v.band !== NO_SIGNAL_BAND);
}

export function readingKindFor(test: TestSummary): ReadingKind {
  // A bipolar instrument (every subscale signed) is a POSITION on a spectrum, not a set of magnitudes.
  if (test.subscales.length > 0 && test.subscales.every((s) => s.signed)) return 'spectrum';
  // Many comparable unipolar facets — the useful summary is which ones lead, by name.
  if (test.subscales.length >= 6) return 'draws';
  return 'bars';
}

export interface SpectrumReading {
  /** The overall placement in words — the band of the leading subscale. */
  band: string;
  /** Where the marker sits, 0..1 left-to-right, mapped from the signed −1..1 value. */
  position: number;
  /** What the two ends mean, so the bar is readable. Derived from the instrument's own band labels. */
  poles: { left: string; right: string };
  /** The one line Klein exists to produce: agreement, or the variable that diverges. Empty when unknowable. */
  divergence: string;
}

/**
 * The overall placement plus the most interesting thing about it. `subscales[0]` is the instrument's own
 * headline (the Kinsey row) — definition order, not a guess — falling back to the most pronounced answered
 * variable when the headline itself was skipped.
 */
export function spectrumReading(
  test: TestSummary,
  scores: TestSubscaleScore[],
): SpectrumReading | null {
  const answered = withSignal(subscaleViews(test, scores));
  if (answered.length === 0) return null;
  const headKey = test.subscales[0]?.key;
  const head = answered.find((v) => v.key === headKey) ?? answered[0];
  if (!head?.band) return null;

  const rest = answered.filter((v) => v.key !== head.key);
  return {
    band: head.band,
    position: (head.normalized + 1) / 2,
    poles: poleLabels(test),
    divergence: divergenceLine(head, rest),
  };
}

/**
 * The ends of the spectrum, taken from the headline subscale's own lowest and highest band labels — so the
 * axis is described in the words the instrument already uses and no second copy of them can drift. Empty
 * when the subscale declares no bands, in which case the caller renders no axis rather than inventing one.
 */
function poleLabels(test: TestSummary): { left: string; right: string } {
  const bands = test.subscales[0]?.bands ?? [];
  return { left: bands[0] ?? '', right: bands[bands.length - 1] ?? '' };
}

/** How far from the headline a variable must sit before it is worth naming — one band's width. */
const DIVERGENCE_GAP = 0.4;

function divergenceLine(head: SubscaleView, rest: SubscaleView[]): string {
  if (rest.length === 0) return '';
  const furthest = [...rest].sort(
    (a, b) => Math.abs(b.normalized - head.normalized) - Math.abs(a.normalized - head.normalized),
  )[0];
  if (!furthest) return '';
  if (Math.abs(furthest.normalized - head.normalized) < DIVERGENCE_GAP) {
    // Agreement is a real finding, not filler — it is what the grid was built to test. Scoped to what was
    // ANSWERED, so it never implies the skipped variables agree too.
    return 'Everything else you answered sits with it.';
  }
  // The label is quoted rather than folded into the sentence: these are long, and lower-casing "Who you've
  // actually had sex with" mid-clause read as a typo.
  return `Except “${furthest.label}” — ${furthest.band ?? ''}.`;
}

export interface DrawsReading {
  /** The leading facets by name — the information a list of 14 has to compress to. */
  draws: { key: string; label: string; strength: number }[];
  /** How many facets actually had answers. The honest denominator: you rated 6 of 14, not 14. */
  rated: number;
}

/** The strongest facets, by name, out of the ones that were actually rated. */
export function drawsReading(
  test: TestSummary,
  scores: TestSubscaleScore[],
  limit = 3,
): DrawsReading | null {
  const answered = withSignal(subscaleViews(test, scores));
  if (answered.length === 0) return null;
  const draws = [...answered]
    .sort((a, b) => b.normalized - a.normalized)
    .slice(0, limit)
    .map((v) => ({ key: v.key, label: v.label, strength: Math.max(0, Math.min(1, v.normalized)) }));
  return { draws, rated: answered.length };
}

/** The default: the strongest few facets as labelled bars — used by everything that isn't a special shape. */
export function barsReading(
  test: TestSummary,
  scores: TestSubscaleScore[],
  limit = 2,
): SubscaleView[] {
  return topSubscales(test, scores, limit).filter((v) => v.band !== NO_SIGNAL_BAND);
}
