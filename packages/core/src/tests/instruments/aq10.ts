import type { Question } from '../../schemas';
import type { TestDefinition } from '../types';

/**
 * Social & sensory reflection (quick) — AQ-10 (51-wellbeing-neurodivergence-reflections §1.2). The Autism
 * Spectrum Quotient (10-item short form) from the Autism Research Centre (ARC), Cambridge. Free to use; must
 * not be modified and must be cited (§8.1). Ten agree/disagree items.
 *
 * Reframed as a non-diagnostic REFLECTION (§8.1): a short, lighter reflection on social, communication, and
 * sensory patterns — never "you are autistic." A deeper reflection (RAADS-R) is available in the same group.
 * Autism reflects a stable trait, so it's retake-allowed but not nudged (§3.4 / §11 Q5).
 */

const AGREE = ['Definitely disagree', 'Slightly disagree', 'Slightly agree', 'Definitely agree'];

const items: Question = {
  id: 'aq10',
  type: 'matrix',
  prompt: 'How much do you agree with each statement?',
  help: 'Answer for how you generally are — there are no right answers.',
  required: true,
  matrix: {
    rows: [
      { key: 'aq-1', label: 'I often notice small sounds when others do not' },
      {
        key: 'aq-2',
        label: 'I usually concentrate more on the whole picture, rather than the small details',
      },
      { key: 'aq-3', label: 'I find it easy to do more than one thing at once' },
      {
        key: 'aq-4',
        label: 'If there is an interruption, I can switch back to what I was doing very quickly',
      },
      {
        key: 'aq-5',
        label: 'I find it easy to read between the lines when someone is talking to me',
      },
      { key: 'aq-6', label: 'I know how to tell if someone listening to me is getting bored' },
      {
        key: 'aq-7',
        label:
          'When I am reading a story, I find it difficult to work out the characters’ intentions',
      },
      { key: 'aq-8', label: 'I like to collect information about categories of things' },
      {
        key: 'aq-9',
        label:
          'I find it easy to work out what someone is thinking or feeling just by looking at their face',
      },
      { key: 'aq-10', label: 'I find it difficult to work out people’s intentions' },
    ],
    min: 1,
    max: 4,
    pointLabels: AGREE,
  },
};

export const AQ10: TestDefinition = {
  id: 'aq10',
  group: 'wellbeing',
  wellbeing: true,
  title: 'Social & sensory reflection (quick)',
  instrument: 'based on AQ-10',
  blurb:
    'A short reflection on social, communication, and sensory experiences that may resonate with you.',
  framing:
    'A reflection on social and sensory patterns you might relate to — not a diagnosis or medical advice.',
  estimatedMinutes: 3,
  version: 1,
  lifeArea: 'Health & body',
  attribution:
    'Based on the Autism Spectrum Quotient (AQ-10), Autism Research Centre, University of Cambridge (Allison, Auyeung & Baron-Cohen). Free for clinical, research, and educational use; reproduced unmodified with citation.',
  items: [items],
  bands: [
    {
      upToRaw: 20,
      clinicalKey: 'few',
      display:
        'Your answers suggest only a few of these social and sensory experiences feel familiar to you.',
    },
    {
      upToRaw: 30,
      clinicalKey: 'some',
      display:
        'Your answers suggest some of these social and sensory experiences resonate with you.',
    },
    {
      upToRaw: 40,
      clinicalKey: 'many',
      display:
        'Your answers suggest many of these social, communication, and sensory experiences you may strongly relate to.',
    },
  ],
  scoring: {
    method: 'subscales',
    scale: { min: 1, max: 4 },
    subscales: [
      {
        key: 'aq10.total',
        label: 'Social & sensory patterns',
        aggregate: 'sum',
        // Items 2–6 & 9 lean autistic when DISAGREED with → reverse-keyed (`-`); 1, 7, 8, 10 lean autistic
        // when agreed with. Higher total = more of these experiences resonate.
        items: [
          'aq-1',
          '-aq-2',
          '-aq-3',
          '-aq-4',
          '-aq-5',
          '-aq-6',
          'aq-7',
          'aq-8',
          '-aq-9',
          'aq-10',
        ],
        normalize: { min: 10, max: 40, out: 'unit' },
      },
    ],
  },
};
