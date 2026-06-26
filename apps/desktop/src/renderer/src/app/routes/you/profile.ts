import type { TestSummary } from '@selfos/core/tests';
import type { TestSubscaleScore } from '@shared/schemas';

/** A scored subscale joined with its display metadata (label + orientation) for the bars/profile cards. */
export interface SubscaleView {
  key: string;
  label: string;
  normalized: number;
  band?: string;
  signed: boolean;
}

/** Join a result's scores with the catalog subscale metadata (labels + signed-ness), in definition order. */
export function subscaleViews(test: TestSummary, scores: TestSubscaleScore[]): SubscaleView[] {
  const scoreByKey = new Map(scores.map((s) => [s.key, s]));
  return test.subscales
    .map((meta) => {
      const score = scoreByKey.get(meta.key);
      if (!score) return null;
      return {
        key: meta.key,
        label: meta.label,
        normalized: score.normalized,
        ...(score.band !== undefined ? { band: score.band } : {}),
        signed: meta.signed,
      };
    })
    .filter((v): v is SubscaleView => v !== null);
}

/**
 * The N strongest subscales for the compact profile-card summary. A **non-signed** (0..1, unipolar
 * interest/trait — e.g. kink draws, Big Five) subscale ranks by its **value** (highest first — a 0% "little
 * pull" must never headline a summary, the bug behind the lopsided kink card); a **signed** (−1..1, bipolar —
 * e.g. attachment anxiety/avoidance) subscale ranks by how far it leans from neutral (the most pronounced
 * pole). Ties keep definition order (a stable sort).
 */
export function topSubscales(
  test: TestSummary,
  scores: TestSubscaleScore[],
  n: number,
): SubscaleView[] {
  return [...subscaleViews(test, scores)].sort((a, b) => prominence(b) - prominence(a)).slice(0, n);
}

function prominence(v: SubscaleView): number {
  return v.signed ? Math.abs(v.normalized) : v.normalized;
}

/**
 * 51 §3.3 — a wellbeing result's GENTLE, non-diagnostic display copy, resolved from the result's internal
 * clinical band (`scores[0].band` = clinicalKey) via the catalog's `bandDisplays`. The clinical key itself is
 * NEVER shown; this returns the plain-language sentence. The gentle low→high value is `scores[0].normalized`.
 */
export function wellbeingDisplay(
  test: TestSummary,
  scores: TestSubscaleScore[],
): { display: string; normalized: number } | undefined {
  const total = scores[0];
  if (!total || total.band === undefined) return undefined;
  const display = test.bandDisplays?.[total.band];
  if (display === undefined) return undefined;
  return { display, normalized: total.normalized };
}
