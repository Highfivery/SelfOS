import type { TestDefinition } from '../types';
import type { Question } from '../../schemas';

/**
 * Attachment style — ECR-R (Experiences in Close Relationships – Revised; 50-self-assessments §4.2). Two
 * dimensions, anxiety and avoidance, 18 items each (36 total), each rendered as one `matrix` Question whose
 * row `key`s are the stable item ids the subscales reference. Items are ECR-R-register originals — NOT
 * verbatim copyrighted text. A handful per subscale are reverse-keyed (`-` prefix in the subscale `items`),
 * which the scorer flips on the 1..7 scale.
 */

const POINT_LABELS = [
  'Strongly disagree',
  'Disagree',
  'Slightly disagree',
  'Neutral',
  'Slightly agree',
  'Agree',
  'Strongly agree',
];

const anxiety: Question = {
  id: 'ecr-anxiety',
  type: 'matrix',
  prompt: 'How much do you agree about your close relationships?',
  help: 'Answer for how you generally feel, not just right now.',
  required: true,
  matrix: {
    rows: [
      {
        key: 'anx1',
        label: "I worry that romantic partners won't care about me as much as I care about them",
      },
      { key: 'anx2', label: 'I need a lot of reassurance that I am loved by my partner' },
      { key: 'anx3', label: 'I often worry that my partner will leave me' },
      { key: 'anx4', label: 'I worry that I will lose my partner one day' },
      { key: 'anx5', label: 'I rarely worry about a partner leaving me' },
      { key: 'anx6', label: "I get frustrated when my partner isn't available when I need them" },
      { key: 'anx7', label: 'I worry a fair amount about losing the people I am close to' },
      { key: 'anx8', label: 'My desire to be very close sometimes scares people away' },
      { key: 'anx9', label: "I find that my partner doesn't want to get as close as I would like" },
      {
        key: 'anx10',
        label: 'I am confident that my partner cares about me as much as I care about them',
      },
      {
        key: 'anx11',
        label: "I often wish my partner's feelings for me were as strong as my feelings for them",
      },
      { key: 'anx12', label: 'I worry about being abandoned' },
      { key: 'anx13', label: 'I feel anxious when I am not close to my partner' },
      {
        key: 'anx14',
        label:
          'When my partner is out of sight, I worry they might become interested in someone else',
      },
      { key: 'anx15', label: "When I show my feelings, I'm afraid my partner won't feel the same" },
      { key: 'anx16', label: 'I rarely worry about my relationships' },
      { key: 'anx17', label: 'I get upset when a partner spends time away from me' },
      { key: 'anx18', label: 'I tend to overanalyze what my partner says and does' },
    ],
    min: 1,
    max: 7,
    pointLabels: POINT_LABELS,
  },
};

const avoidance: Question = {
  id: 'ecr-avoidance',
  type: 'matrix',
  prompt: 'How much do you agree about your close relationships?',
  help: 'Answer for how you generally feel, not just right now.',
  required: true,
  matrix: {
    rows: [
      { key: 'avo1', label: 'I prefer not to show a partner how I feel deep down' },
      { key: 'avo2', label: 'I find it difficult to depend on romantic partners' },
      { key: 'avo3', label: 'I am very comfortable being close to romantic partners' },
      { key: 'avo4', label: 'I find it easy to depend on my partner' },
      { key: 'avo5', label: 'I prefer not to be too close to romantic partners' },
      { key: 'avo6', label: 'I get uncomfortable when a partner wants to be very close' },
      { key: 'avo7', label: 'I find it relatively easy to get close to my partner' },
      { key: 'avo8', label: "It's not difficult for me to get close to my partner" },
      { key: 'avo9', label: 'I usually discuss my problems and concerns with my partner' },
      { key: 'avo10', label: 'It helps to turn to my partner in times of need' },
      { key: 'avo11', label: 'I tell my partner just about everything' },
      { key: 'avo12', label: 'I talk things over with my partner' },
      { key: 'avo13', label: 'I am nervous when partners get too close to me' },
      { key: 'avo14', label: 'I feel comfortable depending on my partner' },
      { key: 'avo15', label: 'I find it easy to count on my partner when I need them' },
      { key: 'avo16', label: "It's easy for me to be affectionate with my partner" },
      { key: 'avo17', label: 'I keep my partner at arm’s length emotionally' },
      { key: 'avo18', label: 'I would rather handle problems on my own than lean on a partner' },
    ],
    min: 1,
    max: 7,
    pointLabels: POINT_LABELS,
  },
};

export const ATTACHMENT: TestDefinition = {
  id: 'ecr-r',
  group: 'relationships',
  title: 'Attachment style',
  instrument: 'ECR-R',
  blurb: 'How you relate in close relationships — along two dimensions, anxiety and avoidance.',
  framing: 'A reflection of how you relate today, not a label or a diagnosis.',
  estimatedMinutes: 8,
  version: 1,
  items: [anxiety, avoidance],
  scoring: {
    method: 'subscales',
    scale: { min: 1, max: 7 },
    subscales: [
      {
        key: 'ecr.anxiety',
        label: 'Attachment anxiety',
        aggregate: 'mean',
        // Higher = more anxious. Reverse-keyed: the reassured/low-worry items (anx5, anx10, anx16).
        items: [
          'anx1',
          'anx2',
          'anx3',
          'anx4',
          '-anx5',
          'anx6',
          'anx7',
          'anx8',
          'anx9',
          '-anx10',
          'anx11',
          'anx12',
          'anx13',
          'anx14',
          'anx15',
          '-anx16',
          'anx17',
          'anx18',
        ],
        normalize: { min: 1, max: 7, out: 'unit' },
        bands: [
          { upTo: 0.33, label: 'lower' },
          { upTo: 0.66, label: 'mixed' },
          { upTo: 1, label: 'heightened' },
        ],
      },
      {
        key: 'ecr.avoidance',
        label: 'Attachment avoidance',
        aggregate: 'mean',
        // Higher = more avoidant. Reverse-keyed: the comfort-with-closeness/depending items
        // (avo3, avo4, avo7, avo8, avo9, avo10, avo11, avo12, avo14, avo15, avo16).
        items: [
          'avo1',
          'avo2',
          '-avo3',
          '-avo4',
          'avo5',
          'avo6',
          '-avo7',
          '-avo8',
          '-avo9',
          '-avo10',
          '-avo11',
          '-avo12',
          'avo13',
          '-avo14',
          '-avo15',
          '-avo16',
          'avo17',
          'avo18',
        ],
        normalize: { min: 1, max: 7, out: 'unit' },
        bands: [
          { upTo: 0.33, label: 'lower' },
          { upTo: 0.66, label: 'mixed' },
          { upTo: 1, label: 'heightened' },
        ],
      },
    ],
  },
};
