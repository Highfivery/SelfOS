import { DIRTY_TALK_SPINE } from '../spine';
import type { AdaptiveTestDefinition } from '../types';
import { DIRTY_TALK_BANK } from './dirtyTalkBank';
import { DIRTY_TALK_NAMES } from './dirtyTalkNames';
import { DIRTY_TALK_NAME_RETIREMENTS } from './dirtyTalkRetirements';

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
  // One bank, two phases: the pet names are marked first and in their own way (74 §3.6.8), the rest in the
  // deck. Merged here rather than kept apart so suppression, the lexicon, the spine and the ask ledger all
  // read a single set of entries.
  bank: {
    families: [...DIRTY_TALK_NAMES.families, ...DIRTY_TALK_BANK.families],
    entries: [...DIRTY_TALK_NAMES.entries, ...DIRTY_TALK_BANK.entries],
    // 74 §3.6.25 — where a retired name's marks go. Only the ones with somewhere to GO are listed; a name
    // cut with no survivor is derived from the family, so the list cannot go stale.
    retiredInto: DIRTY_TALK_NAME_RETIREMENTS,
  },
  spine: DIRTY_TALK_SPINE,
  // The names and the deck are both marked per direction (74 §3.6.26); the AI
  // phases then chase what the bank left ambiguous (74 §3.2).
  // Names first: they are the most usable thing the test produces, and the shortest way in (74 §3.6.8).
  phases: ['names', 'bank', 'lines', 'probe', 'scenario', 'synthesis'],
  saturates: ['Intimacy:dirty-talk'],
  saturationGist:
    'mapped their dirty-talk vocabulary, registers and boundaries in the Dirty Talk test',
  insightSummary:
    'The language you want in bed — what lands, what you can say, and what is off (private).',
};
