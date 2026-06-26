import type { Question } from '../../schemas';
import type { SubscaleSpec, TestDefinition } from '../types';

/**
 * 50-self-assessments §5.2 item 3 — Sexuality & orientation. The Kinsey scale + the Klein Sexual Orientation
 * Grid **structure** (public-domain structure; the item phrasings are SelfOS-original — no proprietary text
 * reproduced, §8.1). **18+ + sensitive** (§3.5/§8.3). Scored on the `'klein'` method (bipolar 0..6-style
 * scales centered on "both equally", so subscales normalize **signed** −1..1: −1 = exclusively other-sex /
 * straight, +1 = exclusively same-sex / gay, 0 = both equally). Everything is matrix-based (numeric records,
 * no auto-seed), so the 7-point columns flex-wrap and never overflow (§9).
 */

/** A concise 7-point bipolar scale (other-sex ↔ same-sex). Short labels so the columns wrap cleanly at 360px. */
const ORIENTATION_POINTS = [
  'Other sex only',
  'Mostly other',
  'Lean other',
  'Both equally',
  'Lean same',
  'Mostly same',
  'Same sex only',
];

/** Plain, non-pathologizing descriptor bands over the signed (−1..1) value. */
const SPECTRUM_BANDS = [
  { upTo: -0.55, label: 'mostly other-sex' },
  { upTo: -0.15, label: 'leans other-sex' },
  { upTo: 0.15, label: 'fairly balanced' },
  { upTo: 0.55, label: 'leans same-sex' },
  { upTo: 1, label: 'mostly same-sex' },
];

/** The seven Klein Sexual Orientation Grid variables (original phrasings). */
const KLEIN_VARIABLES: { key: string; label: string }[] = [
  { key: 'attraction', label: 'Who you’re sexually attracted to' },
  { key: 'behavior', label: 'Who you’ve actually had sex with' },
  { key: 'fantasy', label: 'Who appears in your sexual fantasies' },
  { key: 'emotional', label: 'Who you feel emotionally closest to' },
  { key: 'social', label: 'Who you prefer to socialize with' },
  { key: 'identity', label: 'How you think of your own orientation' },
  { key: 'lifestyle', label: 'The community you feel at home in' },
];

const KLEIN_TIMEFRAMES: { key: string; label: string; help: string }[] = [
  {
    key: 'past',
    label: 'In the past',
    help: 'How things were for most of your life until the last year or so.',
  },
  { key: 'present', label: 'These days', help: 'How things are for you now.' },
  { key: 'ideal', label: 'Ideally', help: 'How you’d most want things to be.' },
];

function kleinMatrix(timeframe: { key: string; label: string; help: string }): Question {
  return {
    id: `klein-${timeframe.key}`,
    type: 'matrix',
    prompt: `${timeframe.label} — where do you fall on each?`,
    help: timeframe.help,
    required: false,
    matrix: {
      rows: KLEIN_VARIABLES.map((variable) => ({
        key: `klein-${timeframe.key}-${variable.key}`,
        label: variable.label,
      })),
      min: 1,
      max: 7,
      pointLabels: ORIENTATION_POINTS,
    },
  };
}

function buildKleinSubscale(variable: { key: string; label: string }): SubscaleSpec {
  return {
    key: `klein.${variable.key}`,
    label: variable.label,
    aggregate: 'mean', // average a variable across past / present / ideal
    items: KLEIN_TIMEFRAMES.map((timeframe) => `klein-${timeframe.key}-${variable.key}`),
    normalize: { min: 1, max: 7, out: 'signed' },
    bands: SPECTRUM_BANDS,
  };
}

const items: Question[] = [
  // The Kinsey overall placement — one 7-point row (a matrix so the value is numeric + no auto-seed).
  {
    id: 'kinsey',
    type: 'matrix',
    prompt: 'Overall, where would you place yourself?',
    help: 'The classic single-scale snapshot — a starting point the grid below then nuances.',
    required: false,
    matrix: {
      rows: [{ key: 'kinsey-overall', label: 'Your overall orientation' }],
      min: 1,
      max: 7,
      pointLabels: ORIENTATION_POINTS,
    },
  },
  ...KLEIN_TIMEFRAMES.map(kleinMatrix),
];

const subscales: SubscaleSpec[] = [
  {
    key: 'kinsey.orientation',
    label: 'Overall orientation',
    aggregate: 'mean',
    items: ['kinsey-overall'],
    normalize: { min: 1, max: 7, out: 'signed' },
    bands: SPECTRUM_BANDS,
  },
  ...KLEIN_VARIABLES.map(buildKleinSubscale),
];

export const SEXUALITY: TestDefinition = {
  id: 'kinsey-klein',
  group: 'intimacy',
  title: 'Sexuality & orientation',
  instrument: 'Kinsey / Klein',
  blurb:
    'A spectrum view of attraction, behavior, and identity — across who you’ve been, who you are, and who you’d like to be.',
  framing:
    'A reflection of how you see yourself today, not a label or a box — and it stays private to you.',
  estimatedMinutes: 8,
  version: 1,
  adult: true,
  sensitive: true,
  items,
  scoring: { method: 'klein', scale: { min: 1, max: 7 }, subscales },
};
