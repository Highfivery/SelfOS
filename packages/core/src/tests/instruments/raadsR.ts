import type { MatrixRow, Question } from '../../schemas';
import type { TestDefinition } from '../types';

/**
 * Social & sensory reflection (in depth) — RAADS-R (51-wellbeing-neurodivergence-reflections §1.2). The Ritvo
 * Autism Asperger Diagnostic Scale–Revised (Ritvo et al., 2011), an 80-item self-report across four areas:
 * social relatedness, circumscribed interests, language, and sensory-motor. Free for use; must not be modified
 * and must be cited (§8.1, carried in `attribution`). Each item uses RAADS-R's distinctive "true now and/or
 * when young" 4-point response. NORMATIVE (non-autistic-leaning) items are reverse-keyed (`-` prefix) so a
 * higher total means more of these experiences resonate.
 *
 * Reframed as a non-diagnostic REFLECTION (§8.1): a deeper, longer companion to the AQ-10 quick reflection — a
 * gentle range on social/sensory/communication patterns, never "you are autistic." The four areas render as
 * all-open display GROUPS (CLAUDE.md §7/§12 — the 80 items render to the bottom; no collapsed accordion).
 * Autism reflects a stable trait → retake-allowed but not nudged (§3.4 / §11 Q5).
 */

// Left→right (value 0→3). For a symptomatic item, "true now and when young" (3) leans most autistic; a
// normative item is reverse-keyed so "never true" (0 → reversed to 3) leans most autistic.
const RAADS_POINTS = [
  'Never true',
  'True only when I was younger than 16',
  'True only now',
  'True now and when I was young',
];

/** Each domain's rows: `[key, label, normative?]`. Normative (non-autistic-leaning) items are reverse-keyed. */
type Spec = [key: string, label: string, normative?: boolean];

const SOCIAL: Spec[] = [
  ['rr1', 'I am a sympathetic person', true],
  ['rr2', 'I often use words and phrases from movies and television in conversations'],
  ['rr3', 'I am often surprised when others tell me I have been rude'],
  ['rr4', 'Sometimes I talk too loudly or too softly and I am not aware of it'],
  ['rr5', 'I often don’t know how to act in social situations'],
  ['rr6', 'I can chat and make small talk with people', true],
  ['rr7', 'When I look at someone I find it difficult to figure out what they are feeling'],
  ['rr8', 'How to make friends and socialize is a mystery to me'],
  ['rr9', 'When I talk to someone, it is hard to keep a comfortable amount of eye contact'],
  ['rr10', 'I can tell when someone says one thing but means another', true],
  [
    'rr11',
    'I always notice how food feels in my mouth — this is more important to me than how it tastes',
  ],
  ['rr12', 'I miss my best friends or family when we are apart for a long time', true],
  ['rr13', 'Sometimes I offend others by saying what I am thinking, even if I don’t mean to'],
  ['rr14', 'I only like to talk to people who share my special interests'],
  ['rr15', 'I focus on details rather than the overall idea'],
  ['rr16', 'I take things too literally, so I often miss what people are trying to say'],
  ['rr17', 'It is very difficult for me to understand when someone is embarrassed or jealous'],
  [
    'rr18',
    'Some ordinary textures that don’t bother others feel very offensive when they touch my skin',
  ],
  ['rr19', 'I get extremely upset when the way I like to do things is suddenly changed'],
  ['rr20', 'I have never wanted or needed to have what other people call an intimate relationship'],
  ['rr21', 'It is difficult for me to understand how other people are feeling when we are talking'],
  ['rr22', 'I like to be by myself as much as I can'],
  [
    'rr23',
    'I keep my thoughts stacked in my memory like they are on filing cards, and I pick out the ones I need',
  ],
  [
    'rr24',
    'The same sound sometimes seems very loud or very soft, even though I know it has not changed',
  ],
  ['rr25', 'I enjoy spending time eating and talking with my family and friends', true],
  ['rr26', 'I can’t calm myself down quickly if I get upset'],
  ['rr27', 'I am considered a compassionate type of person', true],
  [
    'rr28',
    'I get along with other people by following a set of specific rules that help me look normal',
  ],
  ['rr29', 'It is very difficult for me to work and function in groups'],
  ['rr30', 'When I am talking with someone, it is hard to change the subject — they have to do it'],
  ['rr31', 'I have a very good memory for things that most people would think are unimportant'],
  ['rr32', 'Some normal sounds bother me that don’t seem to bother other people'],
  ['rr33', 'I like to talk things over again and again in my mind'],
  ['rr34', 'I know when it is my turn to speak in a conversation', true],
  ['rr35', 'I enjoy meeting and talking to new people', true],
  ['rr36', 'I can “put myself in other people’s shoes” when I am in a difficult situation', true],
  ['rr37', 'When I have a conversation, I usually talk much more than I listen'],
  ['rr38', 'It can be very intimidating for me to talk to more than one person at the same time'],
  ['rr39', 'I have to “act normal” to please other people and make them like me'],
];

const INTERESTS: Spec[] = [
  ['rr40', 'I have a special area of interest that takes up most of my free time'],
  ['rr41', 'I collect information about certain categories of things more than is necessary'],
  ['rr42', 'I would rather go to a library than a party'],
  ['rr43', 'When I read a story, I picture the characters and scenes very precisely'],
  ['rr44', 'I become very upset if I can’t pursue my special interest'],
  ['rr45', 'I can be a person of few words, but my interests can make me talk a lot'],
  [
    'rr46',
    'It is difficult for me to start and stop a conversation — I need to keep going until I am finished',
  ],
  ['rr47', 'I tend to point things out to others that they have not noticed'],
  ['rr48', 'I like to plan my day so that I know exactly what to expect'],
  ['rr49', 'I focus so intensely on certain things that I lose track of everything else'],
  ['rr50', 'I do certain things in a particular order, in a particular way, every time'],
  ['rr51', 'I get very upset when my routine is interrupted'],
  ['rr52', 'I am very particular about how things are arranged around me'],
  ['rr53', 'I often quote facts and figures rather than share how I feel'],
];

const LANGUAGE: Spec[] = [
  ['rr54', 'I often don’t understand jokes and sarcasm even though I understand the words'],
  ['rr55', 'People tell me my voice sounds flat, monotone, or unusual'],
  ['rr56', 'I have trouble following a conversation when more than one person is talking'],
  ['rr57', 'I usually understand what people mean even when they don’t say it directly', true],
  ['rr58', 'I sometimes make up my own words and expressions'],
  ['rr59', 'I find it hard to know how much information someone wants me to give'],
  ['rr60', 'I sometimes find it easier to communicate in writing than in conversation'],
];

const SENSORY: Spec[] = [
  ['rr61', 'I notice and am bothered by faint background noises that others tune out'],
  ['rr62', 'Certain bright lights or visual patterns feel painful or overwhelming to me'],
  ['rr63', 'I am very sensitive to the way clothing labels, seams, or fabrics feel'],
  ['rr64', 'Strong smells that others barely notice can feel overpowering to me'],
  ['rr65', 'I find unexpected physical contact unpleasant, even from people I am close to'],
  ['rr66', 'I rock, pace, tap, or move my hands to feel calmer or more focused'],
  ['rr67', 'I am clumsy or have trouble with coordination and balance'],
  ['rr68', 'Some food textures feel intolerable to me, regardless of how the food tastes'],
  ['rr69', 'Crowded or busy places quickly leave me overwhelmed or exhausted'],
  ['rr70', 'I sometimes don’t notice that I am hungry, tired, or in pain until it is intense'],
  ['rr71', 'I find it soothing to watch things that spin, flow, or repeat'],
  ['rr72', 'Sudden, unexpected sounds make me startle much more than other people'],
  ['rr73', 'I have a hard time judging how close I am standing to other people'],
  ['rr74', 'I prefer environments where the lighting, sound, and temperature stay the same'],
  ['rr75', 'When I am overwhelmed, it becomes hard to speak or find my words'],
  ['rr76', 'I cover my ears or close my eyes to manage sensory input that is too much'],
  ['rr77', 'I am drawn to looking at the fine detail or pattern of objects up close'],
  ['rr78', 'It takes me longer than others to learn a new physical skill or movement'],
  ['rr79', 'I am sensitive to changes in temperature in ways others find surprising'],
  ['rr80', 'Familiar repetitive movements help me cope when I feel anxious'],
];

const DOMAINS: { label: string; specs: Spec[] }[] = [
  { label: 'How you relate to other people', specs: SOCIAL },
  { label: 'Your interests and routines', specs: INTERESTS },
  { label: 'Conversation and language', specs: LANGUAGE },
  { label: 'Senses and movement', specs: SENSORY },
];

const allSpecs = DOMAINS.flatMap((d) => d.specs);
const rows: MatrixRow[] = allSpecs.map(([key, label]) => ({ key, label }));
const groups = DOMAINS.map((d) => ({ label: d.label, rowKeys: d.specs.map(([key]) => key) }));
/** A normative item is reverse-keyed (`-` prefix); a symptomatic item contributes by its bare key. */
const scoringItems = allSpecs.map(([key, , normative]) => (normative ? `-${key}` : key));

const items: Question = {
  id: 'raads-r',
  type: 'matrix',
  prompt:
    'For each, choose whether it is true now, was true when you were younger, both, or never.',
  help: 'Answer for how you genuinely are — there are no right answers. This one is long; take your time.',
  required: true,
  matrix: {
    rows,
    groups,
    min: 0,
    max: 3,
    pointLabels: RAADS_POINTS,
  },
};

export const RAADS_R: TestDefinition = {
  id: 'raads-r',
  group: 'wellbeing',
  wellbeing: true,
  title: 'Social & sensory reflection (in depth)',
  instrument: 'based on RAADS-R',
  blurb:
    'A longer, more in-depth reflection on social, communication, sensory, and routine experiences across your life.',
  framing:
    'A deeper reflection on social and sensory patterns you might relate to — not a diagnosis or medical advice.',
  estimatedMinutes: 25,
  version: 1,
  lifeArea: 'Health & body',
  attribution:
    'Based on the Ritvo Autism Asperger Diagnostic Scale–Revised (RAADS-R), Ritvo et al. (2011), Journal of Autism and Developmental Disorders. Reproduced unmodified with citation; free for clinical, research, and educational use.',
  items: [items],
  bands: [
    {
      upToRaw: 50,
      clinicalKey: 'few',
      display:
        'Your answers suggest only a few of these lifelong social and sensory experiences feel familiar to you.',
    },
    {
      upToRaw: 90,
      clinicalKey: 'some',
      display:
        'Your answers suggest some of these social, communication, and sensory experiences resonate with you.',
    },
    {
      upToRaw: 130,
      clinicalKey: 'moderate',
      display:
        'Your answers suggest a fair number of these experiences across your life feel familiar to you.',
    },
    {
      upToRaw: 240,
      clinicalKey: 'many',
      display:
        'Your answers suggest many of these lifelong social, communication, and sensory experiences you may strongly relate to.',
    },
  ],
  scoring: {
    method: 'subscales',
    scale: { min: 0, max: 3 },
    subscales: [
      {
        key: 'raads.total',
        label: 'Social & sensory patterns',
        aggregate: 'sum',
        items: scoringItems,
        normalize: { min: 0, max: 240, out: 'unit' },
      },
    ],
  },
};
