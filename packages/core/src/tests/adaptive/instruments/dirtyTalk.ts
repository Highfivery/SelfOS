import { DIRTY_TALK_SPINE } from '../spine';
import type { AdaptiveTestDefinition } from '../types';
import { DIRTY_TALK_BANK } from './dirtyTalkBank';

/**
 * 74-adaptive-tests — **Dirty Talk**, the first adaptive instrument: a map of the sexual language a person
 * wants to hear, wants to say, wants to be ABLE to say, and never wants again.
 *
 * The app already knows what this person likes to DO (the activity matrix, the kink test). It knows almost
 * nothing about what they want SAID — and "Explicit dirty talk: ♥♥♥" is nearly useless next to "`good girl`
 * and `mine` land, `filthy little slut` doesn't, and she wants to be able to say `cock` but freezes."
 */
export const DIRTY_TALK: AdaptiveTestDefinition = {
  id: 'dirty-talk',
  kind: 'adaptive',
  group: 'intimacy',
  title: 'Dirty talk',
  instrument: 'SelfOS',
  blurb:
    'What you want said to you, what you want to say, and the words that do nothing for you — mapped properly.',
  framing:
    'A map of what you like said, not a verdict on you. Nobody else reads it. Consensual adults only.',
  estimatedMinutes: 15,
  version: 1,
  adult: true,
  sensitive: true,
  lifeArea: 'Intimacy',
  bank: DIRTY_TALK_BANK,
  spine: DIRTY_TALK_SPINE,
  // Pass 1 marks what lands across the whole bank; pass 2 splits only what was marked into hear/say; the AI
  // phases then chase what the bank left ambiguous (74 §3.2).
  phases: ['bank', 'split', 'lines', 'probe', 'scenario', 'synthesis'],
  saturates: ['Intimacy:dirty-talk'],
  saturationGist:
    'mapped their dirty-talk vocabulary, registers and boundaries in the Dirty Talk test',
  insightSummary:
    'The language you want in bed — what lands, what you can say, and what is off (private).',
};
