import type { TestSubscaleScore } from '../schemas';
import type { NormalizeOut, SubscaleSpec, TestDefinition } from './types';

/**
 * 50-self-assessments §5.1 — the deterministic, AI-free scoring engine. Pure arithmetic (free, offline,
 * instant) + exhaustively unit-tested (§10). `scoreTest(def, answers)` turns a raw answers map into named,
 * normalized subscale scores. `scoreTest` is TOTAL: a missing / out-of-range / corrupt answer is clamped or
 * omitted from its subscale, so a partial mis-entry degrades gracefully rather than throwing the whole score.
 *
 * Item-value resolution: a subscale's `items` reference either a standalone numeric question id
 * (`rating`/`slider`) or a `matrix` ROW KEY. We walk `def.items` once to build `itemId → number`. Reverse
 * scoring (a `-` prefix, e.g. `'-o2'`) flips on the definition's scale (`min + max − value`) — the classic
 * IPIP / ECR-R correctness pitfall, computed centrally here.
 */

/** A flat answers map: question id → its answer value (matrix → a row→point record; numeric otherwise). */
export type ScoreAnswers = Record<
  string,
  string | number | boolean | string[] | Record<string, number> | null | undefined
>;

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** Round to 4 decimals so stored metrics + scores stay clean (no float noise like 0.3333333333). */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Walk the definition's items once → `itemId → numeric value`. Matrix rows contribute by their row key. */
export function itemValues(def: TestDefinition, answers: ScoreAnswers): Map<string, number> {
  const map = new Map<string, number>();
  for (const q of def.items) {
    const value = answers[q.id];
    if (q.type === 'matrix') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [rowKey, raw] of Object.entries(value as Record<string, number>)) {
          if (typeof raw === 'number' && Number.isFinite(raw)) map.set(rowKey, raw);
        }
      }
      continue;
    }
    // rating / slider (and any other numeric-valued item) contribute by question id.
    if (typeof value === 'number' && Number.isFinite(value)) map.set(q.id, value);
  }
  return map;
}

/** Resolve the normalized output kind for a subscale: its own `out`, else the method default. */
function outFor(sub: SubscaleSpec, defaultOut: NormalizeOut): NormalizeOut {
  return sub.normalize.out ?? defaultOut;
}

/** The descriptor band whose ascending `upTo` threshold first covers `normalized` (§3.3). */
function resolveBand(sub: SubscaleSpec, normalized: number): string | undefined {
  if (!sub.bands || sub.bands.length === 0) return undefined;
  const sorted = [...sub.bands].sort((a, b) => a.upTo - b.upTo);
  for (const band of sorted) if (normalized <= band.upTo) return band.label;
  return sorted[sorted.length - 1]?.label;
}

/**
 * Score one subscale: gather each item's (reverse-aware, clamped) contribution, aggregate (sum/mean),
 * normalize onto unit/signed, resolve a band. Items with no answer are OMITTED (mean over what's answered);
 * an all-unanswered subscale floors to its `normalize.min` (normalized 0 / −1).
 */
function scoreSubscale(
  sub: SubscaleSpec,
  values: Map<string, number>,
  scale: { min: number; max: number },
  defaultOut: NormalizeOut,
): TestSubscaleScore {
  const contributions: number[] = [];
  for (const ref of sub.items) {
    const reverse = ref.startsWith('-');
    const id = reverse ? ref.slice(1) : ref;
    const value = values.get(id);
    if (value === undefined) continue; // unanswered → omit (total, never throws)
    const clamped = clamp(value, scale.min, scale.max);
    contributions.push(reverse ? scale.min + scale.max - clamped : clamped);
  }

  const { min, max } = sub.normalize;
  const span = max - min || 1;
  let raw: number;
  if (contributions.length === 0) {
    raw = min; // floor an all-unanswered subscale → normalized 0 / −1
  } else if (sub.aggregate === 'sum') {
    raw = contributions.reduce((a, b) => a + b, 0);
  } else {
    raw = contributions.reduce((a, b) => a + b, 0) / contributions.length;
  }

  const unit = clamp((raw - min) / span, 0, 1);
  const normalized = outFor(sub, defaultOut) === 'signed' ? unit * 2 - 1 : unit;
  const band = resolveBand(sub, round4(normalized));
  return {
    key: sub.key,
    raw: round4(raw),
    normalized: round4(normalized),
    ...(band !== undefined ? { band } : {}),
  };
}

/**
 * Score a self-assessment deterministically (§5.1). Dispatch is on `scoring.method` only to pick the default
 * normalization: `'subscales'` (IPIP/ECR-R/kink) defaults each subscale to `'unit'` (0..1); `'kinsey'`/
 * `'klein'` (the bipolar orientation spectrum, 0..6 centered at 3) default to `'signed'` (−1..1). A subscale's
 * own `normalize.out` always wins. The aggregation itself is one generic engine (the methods differ only in
 * their `SubscaleSpec` data). Total: never throws.
 */
export function scoreTest(def: TestDefinition, answers: ScoreAnswers): TestSubscaleScore[] {
  const values = itemValues(def, answers);
  const defaultOut: NormalizeOut = def.scoring.method === 'subscales' ? 'unit' : 'signed';
  return def.scoring.subscales.map((sub) =>
    scoreSubscale(sub, values, def.scoring.scale, defaultOut),
  );
}

/** The subscale scores as the `Insight.metrics` map (`{ key: normalized }`) — the basis for trends. */
export function scoresToMetrics(scores: TestSubscaleScore[]): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const score of scores) metrics[score.key] = score.normalized;
  return metrics;
}
