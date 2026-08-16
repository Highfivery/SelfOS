import {
  NO_SIGNAL_BAND,
  type EroticLexicon,
  type LexiconEntry,
  type TestSubscaleScore,
} from '../../schemas';

/**
 * 74-adaptive-tests §4.2 — the **spine**: the FIXED set of scored dimensions an adaptive instrument maps onto.
 *
 * Why it has to be fixed. A deterministic test's subscale keys come from its definition, so trends across
 * retakes line up for free. An adaptive test writes its items per take — so if the model also named the
 * dimensions, every retake would produce a different set of keys and `Insight.metrics` trends would break
 * silently (the worst kind of break: the chart still renders, it's just meaningless). The synthesis therefore
 * MAPS onto these keys and may never invent one.
 *
 * Scoring here is DETERMINISTIC and free — computed from the bank ratings, not from the model — so a take
 * that never reaches the AI phases still produces an honest, comparable profile.
 */

export interface SpineDimension {
  key: string;
  label: string;
  description: string;
  /** The bank families whose ratings feed this dimension. */
  families: readonly string[];
  /** Which direction the dimension reads (default: the stronger of the two). */
  direction?: 'hear' | 'say';
}

export const DIRTY_TALK_SPINE: readonly SpineDimension[] = [
  {
    key: 'dirtytalk.explicitness',
    label: 'How explicit',
    description: 'How far up the tiers their real appetite sits.',
    families: [],
  },
  {
    key: 'dirtytalk.praise',
    label: 'Praise',
    description: 'Being told they are good, wanted, perfect.',
    families: ['praise-her', 'praise-him', 'comparisons'],
  },
  {
    key: 'dirtytalk.claiming',
    label: 'Being claimed',
    description: 'Possession — mine, yours, belonging.',
    families: ['claiming', 'self-labelling', 'role-lines'],
  },
  {
    key: 'dirtytalk.command',
    label: 'Being told',
    description: 'Commands, direction, orgasm control.',
    families: ['commands', 'orgasm-control', 'teasing'],
  },
  {
    key: 'dirtytalk.narration',
    label: 'Narration',
    description: 'Being told what is happening, out loud, as it happens.',
    families: ['narration', 'size-fit', 'squirt'],
  },
  {
    key: 'dirtytalk.degradation',
    label: 'Degradation',
    description: 'Being talked down to — the register, not the crudeness.',
    families: ['degradation', 'names-degrading'],
  },
  {
    key: 'dirtytalk.begging',
    label: 'Begging',
    description: 'Asking, earning, permission.',
    families: ['begging'],
  },
  {
    key: 'dirtytalk.taboo',
    label: 'Taboo & roleplay',
    description: 'Pre-agreed roleplay: CNC, strangers, breeding, primal.',
    families: ['taboo', 'watched', 'public-risk'],
  },
  {
    key: 'dirtytalk.receiving-voice',
    label: 'The receiving voice',
    description: 'Asking for what they want, in their own mouth.',
    families: ['demands-receiving'],
    direction: 'say',
  },
  {
    key: 'dirtytalk.giving-voice',
    label: 'The giving voice',
    description: 'Directing, describing, demanding.',
    families: ['demands-giving'],
    direction: 'say',
  },
  {
    key: 'dirtytalk.say-confidence',
    label: 'Saying it out loud',
    description: 'How much of what they love to hear they can actually say.',
    families: [],
  },
];

const BANDS: { upTo: number; label: string }[] = [
  { upTo: 0.2, label: 'not their thing' },
  { upTo: 0.4, label: 'a little' },
  { upTo: 0.6, label: 'yes, in the right moment' },
  { upTo: 0.8, label: 'a clear pull' },
  { upTo: 1, label: 'this is the one' },
];

function band(normalized: number): string {
  for (const b of BANDS) if (normalized <= b.upTo) return b.label;
  return BANDS[BANDS.length - 1]!.label;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** A rating 0..4 → 0..1. A boundary contributes 0 (it is a no, not a missing answer). */
function value(entry: LexiconEntry, direction: SpineDimension['direction']): number {
  if (entry.state === 'never') return 0;
  const raw =
    direction === 'hear'
      ? entry.hear
      : direction === 'say'
        ? entry.say
        : Math.max(entry.hear, entry.say);
  return raw / 4;
}

/**
 * The mean over the entries a dimension draws on. Entries that were never marked are OMITTED rather than
 * counted as zero — the bank is worked by marking only what lands (74 §3.2), so "unrated" means "not marked",
 * never "not interested", and counting it as a zero would drag every dimension toward the floor.
 */
function meanOf(
  entries: LexiconEntry[],
  direction: SpineDimension['direction'],
): { value: number; signal: boolean } {
  const marked = entries.filter(
    (entry) => entry.state !== undefined || entry.hear > 0 || entry.say > 0,
  );
  if (marked.length === 0) return { value: 0, signal: false };
  const total = marked.reduce((sum, entry) => sum + value(entry, direction), 0);
  return { value: total / marked.length, signal: true };
}

/** How far up the tiers their appetite actually reaches — the mean tier of what they LOVED, on 1..5. */
function explicitness(lexicon: EroticLexicon): number {
  const loved = lexicon.entries.filter(
    (entry) => entry.state === undefined && Math.max(entry.hear, entry.say) >= 3,
  );
  if (loved.length === 0) return 0;
  const mean = loved.reduce((sum, entry) => sum + entry.tier, 0) / loved.length;
  return (mean - 1) / 4;
}

/**
 * The say-confidence gap: of everything they love to HEAR, how much can they say? 1 = no gap at all, 0 = they
 * want all of it and can voice none of it. Returns 0 when nothing is loved-to-hear (nothing to be confident
 * about yet) rather than a misleading 1.
 */
function sayConfidence(lexicon: EroticLexicon): number {
  const wanted = lexicon.entries.filter((entry) => entry.state !== 'never' && entry.hear >= 3);
  if (wanted.length === 0) return 0;
  const total = wanted.reduce((sum, entry) => sum + entry.say / 4, 0);
  return total / wanted.length;
}

/**
 * Score a lexicon onto the spine (pure, deterministic, AI-free, total — never throws). The result reuses the
 * spec-50 `TestSubscaleScore` shape, so the existing bars, `Insight.metrics` and `LineChart` trends work
 * unchanged.
 */
export function scoreSpine(
  lexicon: EroticLexicon,
  spine: readonly SpineDimension[] = DIRTY_TALK_SPINE,
): TestSubscaleScore[] {
  const byFamily = new Map<string, LexiconEntry[]>();
  for (const entry of lexicon.entries) {
    const list = byFamily.get(entry.family);
    if (list) list.push(entry);
    else byFamily.set(entry.family, [entry]);
  }
  // Whether the take produced ANY signal at all — the two derived dimensions (explicitness, say-confidence)
  // read the whole lexicon rather than one family, so they share the take's own emptiness.
  const anyMarked = lexicon.entries.some(
    (entry) => entry.state !== undefined || entry.hear > 0 || entry.say > 0,
  );
  return spine.map((dimension) => {
    let normalized: number;
    let signal: boolean;
    if (dimension.key === 'dirtytalk.explicitness') {
      normalized = explicitness(lexicon);
      signal = anyMarked;
    } else if (dimension.key === 'dirtytalk.say-confidence') {
      normalized = sayConfidence(lexicon);
      signal = lexicon.entries.some((entry) => entry.state !== 'never' && entry.hear >= 3);
    } else {
      const entries = dimension.families.flatMap((family) => byFamily.get(family) ?? []);
      const mean = meanOf(entries, dimension.direction);
      normalized = mean.value;
      signal = mean.signal;
    }
    const clamped = normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
    return {
      key: dimension.key,
      raw: round4(clamped),
      normalized: round4(clamped),
      band: signal ? band(round4(clamped)) : NO_SIGNAL_BAND,
    };
  });
}
