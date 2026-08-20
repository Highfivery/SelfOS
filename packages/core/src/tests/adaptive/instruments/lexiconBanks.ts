import type { Bank } from '../bank';
import { DIRTY_TALK_BANK } from './dirtyTalkBank';
import { DIRTY_TALK_NAMES } from './dirtyTalkNames';
import { DIRTY_TALK_RETIREMENTS, DIRTY_TALK_RETIRED_FAMILIES } from './dirtyTalkRetirements';

/**
 * 74 §3.6.34 — the assembled Dirty Talk bank, in a LEAF module.
 *
 * It lives here rather than inline in `dirtyTalk.ts` for one reason: `lexicon.ts` needs it, and
 * `dirtyTalk.ts` imports `spine.ts`, which imports `lexicon.ts`. Importing the instrument from the lexicon
 * would close that loop. This file imports only the three data files and the bank types, so there is no
 * cycle and — because `dirtyTalk.ts` imports it too — no second copy to drift.
 */
export const DIRTY_TALK_FULL_BANK: Bank = {
  families: [...DIRTY_TALK_NAMES.families, ...DIRTY_TALK_BANK.families],
  entries: [...DIRTY_TALK_NAMES.entries, ...DIRTY_TALK_BANK.entries],
  // 74 §3.6.25 — where a retired entry's marks go. Only the ones with somewhere to GO are listed; an entry
  // cut with no survivor is derived from the family, so the list cannot go stale.
  retiredInto: DIRTY_TALK_RETIREMENTS,
  // 74 §3.6.27 — whole registers the owner cut. A family that has LEFT the bank cannot be derived from the
  // bank, so it is named here or its marks outlive every control that could change them.
  retiredFamilies: DIRTY_TALK_RETIRED_FAMILIES,
};

/**
 * Every bank whose entries can appear in the shared `EroticLexicon`.
 *
 * `readLexicon` retires a mark whose key has left the bank against these (74 §3.6.34). The lexicon is ONE
 * store shared by every adaptive intimacy instrument, and `retireCutMarks` is scoped by FAMILY — so an
 * instrument's entries are only ever retired by its own bank, and a custom write-in is never touched.
 * Adding an instrument means appending its bank here; forgetting to would leave its marks un-retired, which
 * is the safe direction to fail.
 */
export const LEXICON_BANKS: readonly Bank[] = [DIRTY_TALK_FULL_BANK];
