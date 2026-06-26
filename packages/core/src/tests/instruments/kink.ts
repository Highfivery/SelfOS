import type { Question } from '../../schemas';
import {
  INTIMACY_CATEGORIES,
  INTIMACY_CATEGORY_LABELS,
  intimacyActivitiesByCategory,
} from '../../intimacy/topics';
import type { SubscaleSpec, TestDefinition } from '../types';

/**
 * 50-self-assessments §5.3 — the original kink & intimacy-interests inventory, **generated** from spec 49's
 * tiered intimacy inventory (`@selfos/core/intimacy`) so the two stay one source of truth (no hand-authored
 * row list to drift). Each of the 14 `INTIMACY_CATEGORIES` becomes a `SubscaleSpec` (a per-category interest
 * score = the MEAN of its activity ratings) + a branched `matrix` revealed only once the person opts into that
 * category (`equalsAny` on the opt-in multiChoice — so the instrument isn't an overwhelming wall, §3.2).
 *
 * Every kink result is **18+ + sensitive + restricted** (§3.4/§8.3). The consensual-adult boundary lives in
 * the inventory + the model, never a keyword filter (`@selfos/core/intimacy/topics`).
 */

/** The shared spec-49 5-point feeling scale (the onboarding intimacy matrix's points). 1 = Hard no … 5 = Love it. */
const FEELING_POINTS = ['Hard no', 'Not interested', 'Curious', 'Like it', 'Love it'];

/** Plain, non-pathologizing interest bands over the normalized (0..1) per-category mean. */
const INTEREST_BANDS = [
  { upTo: 0.25, label: 'little pull' },
  { upTo: 0.5, label: 'some curiosity' },
  { upTo: 0.75, label: 'clear interest' },
  { upTo: 1, label: 'a strong draw' },
];

function buildKinkInterests(): TestDefinition {
  const byCategory = intimacyActivitiesByCategory();
  const items: Question[] = [];
  const subscales: SubscaleSpec[] = [];

  // A single opt-in: which categories to explore. Each category's depth matrix branches on this (§3.2).
  items.push({
    id: 'kink-areas',
    type: 'multiChoice',
    prompt: 'Which of these areas are you open to exploring — or at least curious about?',
    help: 'Pick any. You’ll only be shown detailed items for the areas you choose, and you can change your mind. There’s no right number.',
    required: true,
    options: INTIMACY_CATEGORIES.map((category) => INTIMACY_CATEGORY_LABELS[category]),
  });

  for (const category of INTIMACY_CATEGORIES) {
    const activities = byCategory.get(category) ?? [];
    if (activities.length === 0) continue;
    const label = INTIMACY_CATEGORY_LABELS[category];
    items.push({
      id: `kink-${category}`,
      type: 'matrix',
      prompt: `How do you feel about each? — ${label}`,
      help: 'A hard no is a boundary, not just another option. Skip anything you’d rather not rate.',
      required: false, // an opted-in category's items aren't all required; unrated items are omitted from the mean
      branch: { whenQuestionId: 'kink-areas', equalsAny: [label], action: 'show' },
      matrix: {
        rows: activities.map((activity) => ({ key: activity.key, label: activity.label })),
        min: 1,
        max: 5,
        pointLabels: FEELING_POINTS,
        limitLabels: ['Hard no'],
      },
    });
    subscales.push({
      key: `kink.${category}`,
      label,
      aggregate: 'mean',
      items: activities.map((activity) => activity.key),
      normalize: { min: 1, max: 5, out: 'unit' },
      bands: INTEREST_BANDS,
    });
  }

  return {
    id: 'kink-interests',
    group: 'intimacy',
    title: 'Kink & intimacy interests',
    instrument: 'SelfOS',
    blurb:
      'A private map of what draws you across consensual-adult intimacy — by category, at your own pace.',
    framing:
      'A reflection of what interests you today, not a label or a verdict — and it stays private to you. Consensual adults only.',
    estimatedMinutes: 12,
    version: 1,
    adult: true,
    sensitive: true,
    items,
    scoring: { method: 'subscales', scale: { min: 1, max: 5 }, subscales },
  };
}

export const KINK_INTERESTS: TestDefinition = buildKinkInterests();
