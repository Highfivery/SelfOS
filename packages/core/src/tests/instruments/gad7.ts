import type { Question } from '../../schemas';
import type { TestDefinition } from '../types';

/**
 * Anxiety check-in — GAD-7 (51-wellbeing-neurodivergence-reflections §1.2). The Generalized Anxiety
 * Disorder-7, same authorship/educational grant from Pfizer Inc. as the PHQ-9 — free to use, no permission
 * required. Seven items on the standard 0–3 frequency scale ("Over the last 2 weeks, how often…").
 *
 * Reframed as a non-diagnostic REFLECTION (§8.1): the internal severity bands are kept on the result for
 * trends only; the person sees a gentle, plain-language range and the always-present professional-help line —
 * never "anxiety disorder," never "you have."
 */

const FREQUENCY = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];

const items: Question = {
  id: 'gad7',
  type: 'matrix',
  prompt: 'Over the last 2 weeks, how often have you been bothered by any of the following?',
  help: 'There are no right answers — just what’s been true for you lately.',
  required: true,
  matrix: {
    rows: [
      { key: 'gad7-1', label: 'Feeling nervous, anxious, or on edge' },
      { key: 'gad7-2', label: 'Not being able to stop or control worrying' },
      { key: 'gad7-3', label: 'Worrying too much about different things' },
      { key: 'gad7-4', label: 'Trouble relaxing' },
      { key: 'gad7-5', label: 'Being so restless that it is hard to sit still' },
      { key: 'gad7-6', label: 'Becoming easily annoyed or irritable' },
      { key: 'gad7-7', label: 'Feeling afraid, as if something awful might happen' },
    ],
    min: 0,
    max: 3,
    pointLabels: FREQUENCY,
  },
};

export const GAD7: TestDefinition = {
  id: 'gad7',
  group: 'wellbeing',
  wellbeing: true,
  title: 'Anxiety check-in',
  instrument: 'based on GAD-7',
  blurb: 'A gentle check-in on how much worry and nervousness you’ve been carrying lately.',
  framing: 'A reflection to help you notice how you’ve been — not a diagnosis or medical advice.',
  estimatedMinutes: 2,
  version: 1,
  lifeArea: 'Emotions & patterns',
  attribution:
    'Based on the GAD-7, developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke, and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display, or distribute.',
  items: [items],
  bands: [
    {
      upToRaw: 4,
      clinicalKey: 'minimal',
      display: 'Your answers suggest worry has been fairly quiet for you lately.',
    },
    {
      upToRaw: 9,
      clinicalKey: 'mild',
      display: 'Your answers suggest a little worry has been around for you recently.',
    },
    {
      upToRaw: 14,
      clinicalKey: 'moderate',
      display: 'Your answers suggest a fair amount of worry has been with you lately.',
    },
    {
      upToRaw: 21,
      clinicalKey: 'severe',
      display:
        'Your answers suggest you’ve been carrying a lot of worry recently — that can be exhausting.',
    },
  ],
  scoring: {
    method: 'subscales',
    scale: { min: 0, max: 3 },
    subscales: [
      {
        key: 'gad7.total',
        label: 'Worry',
        aggregate: 'sum',
        items: ['gad7-1', 'gad7-2', 'gad7-3', 'gad7-4', 'gad7-5', 'gad7-6', 'gad7-7'],
        normalize: { min: 0, max: 21, out: 'unit' },
      },
    ],
  },
};
