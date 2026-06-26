import type { Question } from '../../schemas';
import type { TestDefinition } from '../types';

/**
 * Focus & attention reflection — ASRS v1.1 Part A (51-wellbeing-neurodivergence-reflections §1.2). The WHO
 * Adult ADHD Self-Report Scale (ASRS-v1.1) Symptom Checklist, Part A (the 6-item screener). Free to use; the
 * instrument must NOT be modified and the WHO copyright notice must be reproduced with it (carried verbatim in
 * `attribution`, §8.1). Items rate frequency over the past 6 months on the 0–4 scale.
 *
 * Reframed as a non-diagnostic REFLECTION (§8.1): the internal zones are kept on the result for the gentle
 * range; the person sees a plain-language reflection on attention/restlessness patterns — never "you have
 * ADHD." ADHD reflects a stable trait, so it's retake-allowed but not nudged (§3.4 / §11 Q5).
 */

const FREQUENCY = ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'];

const items: Question = {
  id: 'asrs',
  type: 'matrix',
  prompt: 'How often have these happened to you over the past 6 months?',
  help: 'Go with your overall sense — there are no right answers.',
  required: true,
  matrix: {
    rows: [
      {
        key: 'asrs-1',
        label:
          'How often do you have trouble wrapping up the final details of a project, once the challenging parts have been done?',
      },
      {
        key: 'asrs-2',
        label:
          'How often do you have difficulty getting things in order when you have to do a task that requires organization?',
      },
      {
        key: 'asrs-3',
        label: 'How often do you have problems remembering appointments or obligations?',
      },
      {
        key: 'asrs-4',
        label:
          'When you have a task that requires a lot of thought, how often do you avoid or delay getting started?',
      },
      {
        key: 'asrs-5',
        label:
          'How often do you fidget or squirm with your hands or feet when you have to sit down for a long time?',
      },
      {
        key: 'asrs-6',
        label:
          'How often do you feel overly active and compelled to do things, like you were driven by a motor?',
      },
    ],
    min: 0,
    max: 4,
    pointLabels: FREQUENCY,
  },
};

export const ASRS: TestDefinition = {
  id: 'asrs',
  group: 'wellbeing',
  wellbeing: true,
  title: 'Focus & attention reflection',
  instrument: 'based on ASRS v1.1',
  blurb:
    'A short reflection on patterns of attention, organization, and restlessness you might relate to.',
  framing: 'A reflection on how your attention tends to work — not a diagnosis or medical advice.',
  estimatedMinutes: 3,
  version: 1,
  lifeArea: 'Health & body',
  attribution:
    'Based on the Adult ADHD Self-Report Scale (ASRS-v1.1) Symptom Checklist. Copyright © World Health Organization (WHO). Reproduced with the WHO copyright notice; the instrument is not modified.',
  items: [items],
  bands: [
    {
      upToRaw: 7,
      clinicalKey: 'few',
      display:
        'Your answers suggest these attention and restlessness patterns show up only a little for you.',
    },
    {
      upToRaw: 15,
      clinicalKey: 'some',
      display:
        'Your answers suggest you relate to some patterns of distraction or restlessness in everyday life.',
    },
    {
      upToRaw: 24,
      clinicalKey: 'many',
      display:
        'Your answers suggest several patterns of attention, organization, and restlessness you may strongly relate to.',
    },
  ],
  scoring: {
    method: 'subscales',
    scale: { min: 0, max: 4 },
    subscales: [
      {
        key: 'asrs.total',
        label: 'Attention patterns',
        aggregate: 'sum',
        items: ['asrs-1', 'asrs-2', 'asrs-3', 'asrs-4', 'asrs-5', 'asrs-6'],
        normalize: { min: 0, max: 24, out: 'unit' },
      },
    ],
  },
};
