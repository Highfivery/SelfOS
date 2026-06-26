import type { Question } from '../../schemas';
import type { TestDefinition } from '../types';

/**
 * Mood check-in — PHQ-9 (51-wellbeing-neurodivergence-reflections §1.2). The Patient Health Questionnaire-9,
 * developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues with an educational
 * grant from Pfizer Inc. — free to use, no permission required. Nine items on the standard 0–3 frequency scale
 * ("Over the last 2 weeks, how often…"). Item 9 (`phq9-9`, thoughts of self-harm) is the CRISIS trigger
 * (§5.2/§8.2): any non-"Not at all" answer raises `crisisFlag` immediately, mid-check-in.
 *
 * Reframed as a non-diagnostic REFLECTION (§8.1): the internal clinical severity bands are kept on the result
 * for trends only; the person sees a gentle, plain-language range and the always-present professional-help
 * line — never "depression," never "you have," never a clinical verdict.
 */

const FREQUENCY = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];

const items: Question = {
  id: 'phq9',
  type: 'matrix',
  prompt: 'Over the last 2 weeks, how often have you been bothered by any of the following?',
  help: 'There are no right answers — just what’s been true for you lately.',
  required: true,
  matrix: {
    rows: [
      { key: 'phq9-1', label: 'Little interest or pleasure in doing things' },
      { key: 'phq9-2', label: 'Feeling down, depressed, or hopeless' },
      { key: 'phq9-3', label: 'Trouble falling or staying asleep, or sleeping too much' },
      { key: 'phq9-4', label: 'Feeling tired or having little energy' },
      { key: 'phq9-5', label: 'Poor appetite or overeating' },
      {
        key: 'phq9-6',
        label:
          'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
      },
      {
        key: 'phq9-7',
        label: 'Trouble concentrating on things, such as reading or watching television',
      },
      {
        key: 'phq9-8',
        label:
          'Moving or speaking so slowly that other people could have noticed — or being so fidgety or restless that you have been moving around a lot more than usual',
      },
      {
        key: 'phq9-9',
        label: 'Thoughts that you would be better off dead, or of hurting yourself in some way',
      },
    ],
    min: 0,
    max: 3,
    pointLabels: FREQUENCY,
  },
};

export const PHQ9: TestDefinition = {
  id: 'phq9',
  group: 'wellbeing',
  wellbeing: true,
  title: 'Mood check-in',
  instrument: 'based on PHQ-9',
  blurb: 'A gentle check-in on how your mood and energy have been over the last couple of weeks.',
  framing: 'A reflection to help you notice how you’ve been — not a diagnosis or medical advice.',
  estimatedMinutes: 3,
  version: 1,
  lifeArea: 'Emotions & patterns',
  attribution:
    'Based on the PHQ-9, developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke, and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display, or distribute.',
  items: [items],
  crisisItems: [{ questionId: 'phq9-9', atOrAbove: 1 }],
  bands: [
    {
      upToRaw: 4,
      clinicalKey: 'minimal',
      display: 'Your answers suggest your mood has felt mostly okay lately.',
    },
    {
      upToRaw: 9,
      clinicalKey: 'mild',
      display: 'Your answers suggest you’ve been carrying a little low mood recently.',
    },
    {
      upToRaw: 14,
      clinicalKey: 'moderate',
      display: 'Your answers suggest a fair amount of low mood has been weighing on you lately.',
    },
    {
      upToRaw: 19,
      clinicalKey: 'moderately-severe',
      display:
        'Your answers suggest you’ve been carrying a lot of low mood lately — that sounds really hard.',
    },
    {
      upToRaw: 27,
      clinicalKey: 'severe',
      display:
        'Your answers suggest you’ve been going through a really heavy time. You don’t have to carry that alone.',
      crisis: true,
    },
  ],
  scoring: {
    method: 'subscales',
    scale: { min: 0, max: 3 },
    subscales: [
      {
        key: 'phq9.total',
        label: 'Mood',
        aggregate: 'sum',
        items: [
          'phq9-1',
          'phq9-2',
          'phq9-3',
          'phq9-4',
          'phq9-5',
          'phq9-6',
          'phq9-7',
          'phq9-8',
          'phq9-9',
        ],
        normalize: { min: 0, max: 27, out: 'unit' },
      },
    ],
  },
};
