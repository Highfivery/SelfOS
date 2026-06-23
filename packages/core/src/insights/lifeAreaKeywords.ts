import { LIFE_AREAS } from '../schemas';

/**
 * A cheap, deterministic keyword → life-area map (28 §13). It powers TWO non-model uses: the free-form
 * session **shift-trigger** (`topicShifted` — decides WHEN to re-run the Haiku classifier; the topic itself is
 * always the model's answer, never these keywords) and the **dream** topic derivation (`dreamTopic` — fully
 * deterministic, no model). It is intentionally NOT used to classify a session's topic (that's the model's job;
 * a pure-keyword classifier was the rejected option). Keywords are lowercased word-START stems matched at a word
 * boundary (so "anxie" catches anxiety/anxious; "god" never matches "good"). `Other` has no keywords (fallback).
 */
const LIFE_AREA_KEYWORDS: Record<string, string[]> = {
  Relationships: [
    'partner',
    'boyfriend',
    'girlfriend',
    'husband',
    'wife',
    'spouse',
    'friend',
    'dating',
    'breakup',
    'relationship',
    'marriage',
    'married',
    'divorc',
  ],
  Family: [
    'mom',
    'mother',
    'dad',
    'father',
    'parent',
    'sister',
    'brother',
    'sibling',
    'son',
    'daughter',
    'child',
    'kids',
    'family',
    'grandma',
    'grandpa',
    'grandmother',
    'grandfather',
    'aunt',
    'uncle',
    'cousin',
  ],
  'Work & purpose': [
    'work',
    'job',
    'boss',
    'career',
    'colleague',
    'coworker',
    'co-worker',
    'office',
    'promotion',
    'fired',
    'layoff',
    'business',
    'meeting',
    'deadline',
    'manager',
    'employ',
    'purpose',
    'calling',
  ],
  'Health & body': [
    'health',
    'sick',
    'illness',
    'pain',
    'sleep',
    'insomnia',
    'tired',
    'exhaust',
    'exercise',
    'gym',
    'workout',
    'diet',
    'doctor',
    'body',
    'weight',
    'energy',
    'injur',
  ],
  'Emotions & patterns': [
    'anxious',
    'anxiety',
    'depress',
    'sad',
    'angry',
    'anger',
    'stress',
    'overwhelm',
    'lonely',
    'loneli',
    'worry',
    'worried',
    'fear',
    'afraid',
    'grief',
    'grieving',
    'panic',
    'mood',
    'numb',
    'hopeless',
  ],
  'Values & beliefs': ['value', 'belief', 'principle', 'integrity', 'moral', 'ethic', 'honesty'],
  Intimacy: [
    'sex',
    'intimacy',
    'intimate',
    'attraction',
    'desire',
    'libido',
    'arousal',
    'kink',
    'porn',
    'foreplay',
    'orgasm',
    'horny',
    'lust',
  ],
  'Goals & growth': [
    'goal',
    'habit',
    'growth',
    'improve',
    'ambition',
    'resolution',
    'progress',
    'discipline',
  ],
  Money: [
    'money',
    'debt',
    'salary',
    'budget',
    'financ',
    'rent',
    'bills',
    'saving',
    'spend',
    'afford',
    'paycheck',
    'income',
    'broke',
    'expensive',
  ],
  Faith: [
    'god',
    'faith',
    'pray',
    'prayer',
    'church',
    'mosque',
    'temple',
    'spiritual',
    'religio',
    'soul',
    'worship',
  ],
};

/** Precompiled per-area regexes: each keyword anchored at a word boundary (prefix-stem match). */
const AREA_PATTERNS: { area: string; re: RegExp }[] = LIFE_AREAS.filter(
  (area) => (LIFE_AREA_KEYWORDS[area]?.length ?? 0) > 0,
).map((area) => ({
  area,
  // `\b(kw1|kw2|…)` — a word boundary before any keyword stem. Escaping is unneeded (keywords are plain).
  re: new RegExp(`\\b(${(LIFE_AREA_KEYWORDS[area] ?? []).join('|')})`, 'i'),
}));

/**
 * The life-areas a chunk of text touches, in canonical `LIFE_AREAS` order (deduped). Deterministic + cheap —
 * no model call. Returns `[]` when nothing matches (the safe "no strong signal" reading).
 */
export function lifeAreasFromText(text: string): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  return AREA_PATTERNS.filter(({ re }) => re.test(haystack)).map(({ area }) => area);
}
