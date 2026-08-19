import type { FileSystem } from '../../host';
import { isSafeSegment } from '../../pathSafety';
import {
  EroticLexiconSchema,
  type EroticLexicon,
  type LexiconBoundary,
  type LexiconEntry,
  type LexiconState,
} from '../../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../../vault';
import { bankEntry, toLexiconEntry, type Bank, type BankEntry } from './bank';
import { shownSides, type Orientation } from './orientation';

/**
 * 74-adaptive-tests §4.4 — the shared **erotic lexicon**: ONE per person, written by every adaptive intimacy
 * test (Dirty Talk today; Fantasy and Sex Sessions next) and read by every explicit surface in the app.
 *
 * Three results, one lexicon (74 §1.3, owner decision), so no test re-asks another's ground and — the
 * load-bearing part — **a boundary recorded in one constrains all of them, and every consumer**.
 *
 * Two rules this module exists to make unbreakable:
 *
 * 1. **A `never` is permanent.** Nothing merges it away, no retake re-offers it, and only an explicit act by
 *    the person themselves clears it (`clearState`). A merge that could silently downgrade a hard no would be
 *    the worst bug this feature could have.
 * 2. **Boundaries UNION on merge.** Two devices editing the same lexicon resolve last-write-wins on ratings,
 *    but their boundary lists are combined — a sync conflict can never lose a hard no (74 §7).
 */

const SCHEMA_VERSION = 1;

export function lexiconPath(personId: string): string {
  return `people/${personId}/tests/lexicon.enc`;
}

export function emptyLexicon(personId: string, now: Date): EroticLexicon {
  return {
    schemaVersion: SCHEMA_VERSION,
    personId,
    entries: [],
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    boundaries: [],
    updatedAt: now.toISOString(),
  };
}

/**
 * Read a person's lexicon, deriving an empty one when absent. A corrupt doc degrades to empty rather than
 * throwing out of the session/questionnaire that depends on it — the app then behaves exactly as it did
 * before this spec (no lexicon signal) instead of dead-ending (74 §7).
 */
export async function readLexicon(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date = new Date(),
): Promise<EroticLexicon> {
  if (!isSafeSegment(personId)) return emptyLexicon(personId, now);
  try {
    const raw = await readEncryptedJson(fs, lexiconPath(personId), key);
    if (!raw) return emptyLexicon(personId, now);
    const parsed = EroticLexiconSchema.safeParse(raw);
    return parsed.success ? parsed.data : emptyLexicon(personId, now);
  } catch {
    return emptyLexicon(personId, now);
  }
}

export async function writeLexicon(
  fs: FileSystem,
  key: Uint8Array,
  lexicon: EroticLexicon,
): Promise<void> {
  if (!isSafeSegment(lexicon.personId)) return;
  await writeEncryptedJson(fs, lexiconPath(lexicon.personId), lexicon, key);
}

/**
 * How one entry landed in the bank pass (74 §3.6.2): loved it, it's okay, or it's a boundary. `okay` is a
 * MILD YES — fine, works, not a favourite — not the superseded "makes me cringe".
 */
export type BankMark = 'love' | 'never' | 'okay';

/** Pass 1 — the whole bank, marking only what lands. Everything untouched stays genuinely unrated. */
export interface BankMarks {
  [entryKey: string]: BankMark;
}

/** The rating a `love` mark seeds before pass 2 splits it into hear/say. */
const LOVE_SEED = 3;

/**
 * Were both directions actually put to this person? Absent `sides` ⇒ yes, which is true of every entry
 * written before orientation existed (74 §3.6.6). Used wherever a `0` would otherwise be read as a refusal.
 */
export function bothSidesAsked(entry: LexiconEntry): boolean {
  return entry.sides === undefined || (entry.sides.includes('hear') && entry.sides.includes('say'));
}

/** Was this person ever asked to rate saying it? A say-direction signal must not count entries that weren't. */
export function saySideAsked(entry: LexiconEntry): boolean {
  return entry.sides === undefined || entry.sides.includes('say');
}

/**
 * 74 §3.6.11 — did they actually ANSWER this side, as opposed to being offered it?
 *
 * For a deck entry the two are the same: a both-sides row rated in the split has a real 0. For a PET NAME they
 * are not. Every name row offers both directions, so `sides` is trivially satisfied — but marking one side and
 * leaving the other blank is not a rating of zero, and reading it as one put a false statement in front of the
 * person ("you love hearing 'good girl' but rated it 0 to say" — they rated nothing) and fed the same invented
 * gap to `wantsToSay`, the probe and the lines phase.
 *
 * A name is recognised by carrying per-direction marks at all; `hear`/`say` are derived from them.
 */
function directionAnswered(entry: LexiconEntry, side: 'hear' | 'say'): boolean {
  const perDirection = entry.hearState !== undefined || entry.sayState !== undefined;
  if (perDirection) return (side === 'hear' ? entry.hearState : entry.sayState) !== undefined;
  return side === 'hear'
    ? entry.sides === undefined || entry.sides.includes('hear')
    : saySideAsked(entry);
}

/** Was saying it actually answered? Use wherever a low/zero `say` is read as a signal. */
export function saySideAnswered(entry: LexiconEntry): boolean {
  return directionAnswered(entry, 'say');
}

/** Were BOTH directions actually answered? The gap between them is only real when they were. */
export function bothSidesAnswered(entry: LexiconEntry): boolean {
  return directionAnswered(entry, 'hear') && directionAnswered(entry, 'say');
}

/**
 * Apply pass-1 marks onto a lexicon (pure). An entry marked `love` is seeded at {@link LOVE_SEED} in BOTH
 * directions and refined in pass 2; `never`/`notYet` set the state and zero the ratings, and a `never`
 * additionally records a global {@link LexiconBoundary}.
 *
 * An unknown key (not in the bank) is skipped rather than inventing an entry — a custom write-in comes in
 * through {@link addCustomEntry}, which knows its text.
 */
export function applyBankMarks(
  lexicon: EroticLexicon,
  bank: Bank,
  marks: BankMarks,
  source: string,
  now: Date,
  /** Which sides each key was SHOWN on (74 §3.6.6). Absent for a key ⇒ both, the pre-orientation behaviour. */
  sidesByKey: Readonly<Record<string, readonly ('hear' | 'say')[]>> = {},
): EroticLexicon {
  const byKey = new Map(lexicon.entries.map((entry) => [entry.key, entry]));
  const boundaries = [...lexicon.boundaries];
  for (const [key, mark] of Object.entries(marks)) {
    const spec = bankEntry(bank, key);
    const existing = byKey.get(key);
    if (!spec && !existing) continue;
    // 74 §3.2 (amended 2026-08-19): a `never` is a PREFERENCE, not a permanent boundary. It is respected
    // for exactly as long as it is set, and the person may change it in any sitting — so nothing blocks a
    // re-mark here. Suppression is derived from the live state by `suppressedTexts`, which is what makes
    // lifting it instant: change the mark and the word stops being suppressed on the next read.
    const shownSides = sidesByKey[key];
    // Record what was ASKED, so a `0` on a side that was never offered is distinguishable from a refusal.
    const withSides = shownSides ? { sides: [...shownSides] } : {};
    const base = { ...(existing ?? toLexiconEntry(spec as BankEntry, source)), ...withSides };
    if (mark === 'love') {
      // Seed ONLY when there is nothing to preserve. Re-sending the whole pass (which closing it does) would
      // otherwise reset a hear:4/say:1 split back to 3/3 — and quitting between the two passes, which the
      // autosave copy actively encourages, is exactly when that lands and never gets repaired.
      const seeded = base.hear === 0 && base.say === 0;
      // …and seed ONLY the sides this person was actually shown (74 §3.6.6). §3.6.6 fixed a `0` on an unshown
      // side being read as a refusal; seeding both directions is the same bug inverted — a `3` on a side that
      // was never offered reads as an ENDORSEMENT, and the report then tells someone they are "comfortable
      // saying" a line the deck never put to them, on the one screen §8.5 says they may read to a partner.
      const shown = shownSides ?? (['hear', 'say'] as const);
      const seedFor = (side: 'hear' | 'say'): number =>
        seeded && shown.includes(side) ? LOVE_SEED : base[side];
      byKey.set(key, {
        ...base,
        hear: seedFor('hear'),
        say: seedFor('say'),
        state: undefined,
        source,
      });
    } else {
      // No boundary RECORD is written for a bank entry any more. A second copy of the same fact is what
      // made a `never` unliftable: the entry could change and the record could not. `boundaries` now holds
      // only what is not a bank entry — a theme a probe named ("anything about being used").
      byKey.set(key, { ...base, hear: 0, say: 0, state: mark, source });
    }
  }
  return {
    ...lexicon,
    entries: [...byKey.values()],
    boundaries: dedupeBoundaries(boundaries),
    updatedAt: now.toISOString(),
  };
}

/** One name's answer: a mark per direction. Either side may be absent — an unanswered side stays unanswered. */
export type NameMark = { hear?: BankMark; say?: BankMark };
export type NameMarks = Record<string, NameMark>;

/** love → 4, okay → 2, never → 0. The ratings stay the currency every existing consumer reads. */
function ratingFor(mark: BankMark | undefined, current: number): number {
  if (mark === 'love') return LOVE_SEED >= 4 ? LOVE_SEED : 4;
  if (mark === 'okay') return 2;
  if (mark === 'never') return 0;
  return current;
}

/**
 * The PET-NAME pass (74 §3.6.8) — a name answered twice, once per direction.
 *
 * The deck's `applyBankMarks` cannot do this: it takes one mark for the whole entry and then a second pass
 * splits it. A name has no single answer to split — wanting to call her "good girl" says nothing about
 * wanting to be called it — so both marks arrive together and each writes its own side.
 *
 * Three things it does that the deck's version does not:
 *
 * 1. **`hear`/`say` stay derived** (love → 4, okay → 2, never → 0), so the spine, the steer, the report and
 *    every other consumer keep reading the two numbers they always read. `hearState`/`sayState` are what the
 *    phase itself reads back.
 * 2. **A `never` writes a DIRECTIONAL boundary.** "Never call me slut" must not stop him calling her slut,
 *    which is the whole reason `LexiconBoundary.direction` exists.
 * 3. **A settled boundary from an EARLIER take is not re-marked**, matching the deck: it lifts only by an
 *    explicit un-mark, never by marking over it.
 */
export function applyNameMarks(
  lexicon: EroticLexicon,
  bank: Bank,
  marks: NameMarks,
  source: string,
  now: Date,
  /**
   * Which sides each key was SHOWN on (74 §3.6.3). Absent for a key ⇒ both, the pre-orientation behaviour.
   * A name whose register names a gender neither of you is only offers one direction now, so recording both
   * would put a fact in the file that the screen never asked.
   */
  sidesByKey: Readonly<Record<string, readonly ('hear' | 'say')[]>> = {},
): EroticLexicon {
  const byKey = new Map(lexicon.entries.map((entry) => [entry.key, entry]));
  const boundaries = [...lexicon.boundaries];
  for (const [key, mark] of Object.entries(marks)) {
    const spec = bankEntry(bank, key);
    const existing = byKey.get(key);
    if (!spec && !existing) continue;
    // A name's `never` is a preference too, per direction, and is re-markable in any sitting.
    const base = existing ?? toLexiconEntry(spec as BankEntry, source);
    const hearState = mark.hear ?? base.hearState;
    const sayState = mark.say ?? base.sayState;
    byKey.set(key, {
      ...base,
      hear: ratingFor(mark.hear, base.hear),
      say: ratingFor(mark.say, base.say),
      ...(hearState ? { hearState } : {}),
      ...(sayState ? { sayState } : {}),
      // What was actually put to them. This phase asks BOTH directions per name — that is what makes it two
      // marks rather than one — EXCEPT where orientation withheld a side, so the shown sides are recorded
      // rather than assumed. Hardcoding both used to be true and became a lie the moment names were
      // oriented; a `0` on a side that was never offered reads as a refusal (§3.6.6).
      sides: [...(sidesByKey[key] ?? (['hear', 'say'] as const))],
      state: undefined,
      source,
    });
  }
  return {
    ...lexicon,
    entries: [...byKey.values()],
    boundaries: dedupeBoundaries(boundaries),
    updatedAt: now.toISOString(),
  };
}

/** Take back a name mark — one direction, or both. The undo path for the phase's autosave (74 §3.4). */
export function clearNameMarks(
  lexicon: EroticLexicon,
  cleared: Readonly<Record<string, readonly ('hear' | 'say')[]>>,
  now: Date,
): EroticLexicon {
  const entries = lexicon.entries.map((entry) => {
    const sides = cleared[entry.key];
    // Not scoped to the take that wrote it: a mark is a preference, so taking it back in a later sitting is
    // the same ordinary act as changing it.
    if (!sides) return entry;
    const next = { ...entry };
    for (const side of sides) {
      if (side === 'hear') {
        next.hear = 0;
        delete next.hearState;
      } else {
        next.say = 0;
        delete next.sayState;
      }
    }
    return next;
  });
  const clearedTexts = new Map<string, Set<'hear' | 'say'>>();
  for (const [key, sides] of Object.entries(cleared)) {
    const entry = lexicon.entries.find((e) => e.key === key);
    if (!entry) continue;
    clearedTexts.set(entry.text, new Set(sides));
  }
  const boundaries = lexicon.boundaries.filter((boundary) => {
    const sides = clearedTexts.get(boundary.text);
    if (!sides) return true;
    // Only the direction they took back — an un-mark on one side leaves the other side's boundary standing.
    return !(boundary.direction && sides.has(boundary.direction));
  });
  return { ...lexicon, entries, boundaries, updatedAt: now.toISOString() };
}

/**
 * 74 §3.6.3 — drop what this person is no longer asked (owner decision, 2026-08-19).
 *
 * Orientation used to be a pure display filter, and for the deck alone that was survivable. Once it reaches
 * the pet names it stops being survivable, because a mark on a side nobody can see any more still WORKS:
 * `suppressedTexts` derives suppression from the live `state`/`hearState`/`sayState`, so a `never` on a
 * hidden side keeps that word out of every generated line app-wide with no control left on screen to lift
 * it. That is precisely the un-gettable-rid-of preference §3.2 was amended to abolish.
 *
 * So a mark on an unshown side is REMOVED, not merely ignored:
 *
 * - one side hidden → that side's rating and per-direction state go; the other side is untouched
 * - both hidden → the entry goes entirely, `state` and all, which is what actually releases a deck `never`
 * - a key the bank does not know (a custom write-in, a retired entry) is never touched — we cannot resolve
 *   which sides it would be shown on, and guessing would delete something the person typed themselves
 *
 * Boundaries are left alone: a themed boundary a probe named ("anything about being used") is not a bank
 * entry and has no side to be hidden on.
 *
 * Returns `changed` so a caller can skip the write when there is nothing to do — this runs on read.
 */
export function pruneUnshownMarks(
  lexicon: EroticLexicon,
  bank: Bank,
  who: Orientation,
  now: Date,
): { lexicon: EroticLexicon; changed: boolean } {
  const retired = retireCutMarks(lexicon.entries, bank);
  let changed = retired.changed;
  const entries: LexiconEntry[] = [];
  for (const entry of retired.entries) {
    const spec = bankEntry(bank, entry.key);
    if (!spec) {
      entries.push(entry);
      continue;
    }
    const shown = shownSides(spec, who);
    if (shown.length === 0) {
      changed = true;
      continue;
    }
    let next = entry;
    if (!shown.includes('hear') && (entry.hear !== 0 || entry.hearState !== undefined)) {
      next = { ...next, hear: 0 };
      delete next.hearState;
      changed = true;
    }
    if (!shown.includes('say') && (entry.say !== 0 || entry.sayState !== undefined)) {
      next = { ...next, say: 0 };
      delete next.sayState;
      changed = true;
    }
    // Record what is actually on offer now, so a 0 on an unshown side is never read as a refusal (§3.6.6).
    if (
      next.sides === undefined ||
      next.sides.length !== shown.length ||
      !shown.every((side) => next.sides?.includes(side))
    ) {
      next = { ...next, sides: [...shown] };
      changed = true;
    }
    entries.push(next);
  }
  if (!changed) return { lexicon, changed: false };
  return { lexicon: { ...lexicon, entries, updatedAt: now.toISOString() }, changed: true };
}

/**
 * 74 §3.6.25 — marks on a name this bank has RETIRED. A separate pass, run before orientation.
 *
 * Cutting a name from the bank does not cut it from anyone's lexicon: every consumer reads the person's own
 * store, so nobody loses an answer to a purge (#534). That is right for the ANSWER and wrong for the
 * CONTROL — the row that could change it goes with the entry, while `suppressedTexts` keeps reading the
 * mark. A `never` on a retired name therefore keeps that word out of every generated line with nothing left
 * on any screen to lift it: the un-gettable-rid-of preference §3.2 abolished, reached through the bank
 * instead of through orientation.
 *
 * Two kinds of cut, two answers:
 *
 * - **Retired INTO another name** (`bank.retiredInto`) — "my love" went because "love" says the same thing,
 *   so the mark MOVES. The survivor's own answer always wins; this only fills a side they left blank, so a
 *   migration can never overwrite something they actually said.
 * - **Retired outright** — "my paperweight" names nothing anyone is called, so there is nowhere to move it
 *   and the mark goes with the word. Derived rather than listed: an entry whose FAMILY belongs to this bank
 *   but whose KEY no longer does was cut from it, whenever that happened.
 *
 * Scoping by family is what makes the derived half safe. The lexicon is ONE store shared by every adaptive
 * intimacy instrument, so another instrument's entries carry families this bank has never heard of and are
 * left alone — as is a custom write-in, which is the person's own word and was never the bank's to retire.
 */
function retireCutMarks(
  all: readonly LexiconEntry[],
  bank: Bank,
): { entries: LexiconEntry[]; changed: boolean } {
  const ourFamily = new Set(bank.families.map((family) => family.id));
  const isRetired = (entry: LexiconEntry): boolean =>
    !entry.custom && ourFamily.has(entry.family) && bankEntry(bank, entry.key) === undefined;
  if (!all.some(isRetired)) return { entries: [...all], changed: false };

  const kept = new Map(all.filter((entry) => !isRetired(entry)).map((entry) => [entry.key, entry]));
  for (const entry of all) {
    if (!isRetired(entry)) continue;
    const into = bank.retiredInto?.[entry.key];
    const spec = into === undefined ? undefined : bankEntry(bank, into);
    if (into === undefined || spec === undefined) continue; // retired outright — the mark goes with it
    const survivor = kept.get(into);
    if (!survivor) {
      // Nothing marked on the survivor, so the answer moves across whole — under the survivor's own key
      // and text, or the report would show them a name the bank no longer has.
      kept.set(into, { ...entry, key: into, text: spec.text, family: spec.family });
      continue;
    }
    kept.set(into, {
      ...survivor,
      ...(survivor.state === undefined && entry.state ? { state: entry.state } : {}),
      ...(survivor.hearState === undefined && entry.hearState
        ? { hearState: entry.hearState }
        : {}),
      ...(survivor.sayState === undefined && entry.sayState ? { sayState: entry.sayState } : {}),
      // A rating only fills a side the survivor left genuinely unanswered.
      hear: survivor.hearState === undefined && survivor.hear === 0 ? entry.hear : survivor.hear,
      say: survivor.sayState === undefined && survivor.say === 0 ? entry.say : survivor.say,
    });
  }
  return { entries: [...kept.values()], changed: true };
}

/** Pass 2 — the hear/say split, applied only to entries pass 1 marked. */
export function applyDirections(
  lexicon: EroticLexicon,
  splits: Record<string, { hear?: number; say?: number }>,
  now: Date,
): EroticLexicon {
  const clamp = (n: number): number => (n < 0 ? 0 : n > 4 ? 4 : Math.round(n));
  const entries = lexicon.entries.map((entry) => {
    const split = splits[entry.key];
    // A boundary is never re-rated by the split pass.
    if (!split || entry.state === 'never') return entry;
    return {
      ...entry,
      ...(split.hear !== undefined ? { hear: clamp(split.hear) } : {}),
      ...(split.say !== undefined ? { say: clamp(split.say) } : {}),
    };
  });
  return { ...lexicon, entries, updatedAt: now.toISOString() };
}

/** Add one of their own words. Custom entries carry `custom: true` and a `custom:` key namespace. */
export function addCustomEntry(
  lexicon: EroticLexicon,
  input: { text: string; family: string; kind: 'word' | 'phrase'; tier?: 1 | 2 | 3 | 4 | 5 },
  source: string,
  now: Date,
): EroticLexicon {
  const text = input.text.trim();
  if (text === '') return lexicon;
  const key = `custom:${input.family}:${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  if (lexicon.entries.some((entry) => entry.key === key)) return lexicon;
  const entry: LexiconEntry = {
    key,
    text,
    kind: input.kind,
    family: input.family,
    tier: input.tier ?? 3,
    hear: 0,
    say: 0,
    custom: true,
    source,
  };
  return { ...lexicon, entries: [...lexicon.entries, entry], updatedAt: now.toISOString() };
}

/**
 * The ONLY way a boundary lifts: an explicit act by the person themselves (74 §3.2/§8.2). Clearing a `never`
 * drops its global boundary too, so the suppression stops with it.
 */
export function clearState(lexicon: EroticLexicon, key: string, now: Date): EroticLexicon {
  const target = lexicon.entries.find((entry) => entry.key === key);
  if (!target) return lexicon;
  return {
    ...lexicon,
    entries: lexicon.entries.map((entry) =>
      entry.key === key ? { ...entry, state: undefined } : entry,
    ),
    boundaries:
      target.state === 'never'
        ? lexicon.boundaries.filter((b) => !sameBoundary(b.text, target.text))
        : lexicon.boundaries,
    updatedAt: now.toISOString(),
  };
}

/**
 * Undo bank marks — the other half of autosaving a pass (74 §3.4).
 *
 * Once every tap persists the moment it lands, a mis-tap is written to the lexicon before the person can look
 * at it. Without this an accidental ✗ would be a permanent boundary they never meant, and an accidental 🔥
 * would keep seeding their own coach. So un-marking has to reach the store too: it clears the state, zeroes
 * the ratings the mark seeded, and drops the boundary a `never` created.
 *
 * This is NOT the §3.2 "a boundary lifts only by an explicit act" escape hatch being widened — un-marking IS
 * that explicit act, by the same person, in the same sitting, on a mark they just made.
 *
 * **`source` is what makes that true, not the UI.** Every mark records the take that made it
 * (`test:<resultId>`), and un-marking is scoped to the CURRENT take's marks. So a boundary set in an earlier
 * take cannot be cleared through this path even if the renderer asks for it — which matters, because the
 * renderer is not the trust boundary: without this, one crafted `cleared` key would lift a hard no that §3.2
 * promises only the report can lift. A wrong or missing `source` clears nothing.
 */
export function clearMarks(
  lexicon: EroticLexicon,
  keys: readonly string[],
  now: Date,
): EroticLexicon {
  if (keys.length === 0) return lexicon;
  const wanted = new Set(keys);
  // Not scoped to the take that wrote it — see `clearNameMarks`.
  const clearable = (entry: LexiconEntry): boolean => wanted.has(entry.key);
  const dropped = lexicon.entries.filter((entry) => clearable(entry) && entry.state === 'never');
  if (!lexicon.entries.some(clearable)) return lexicon;
  return {
    ...lexicon,
    entries: lexicon.entries.map((entry) =>
      clearable(entry) ? { ...entry, state: undefined, hear: 0, say: 0 } : entry,
    ),
    boundaries: lexicon.boundaries.filter(
      (b) => !dropped.some((entry) => sameBoundary(b.text, entry.text)),
    ),
    updatedAt: now.toISOString(),
  };
}

/** Record a boundary that isn't a bank entry (a theme named in a probe: "anything about being used"). */
export function addBoundary(
  lexicon: EroticLexicon,
  boundary: Omit<LexiconBoundary, 'at'>,
  now: Date,
): EroticLexicon {
  return {
    ...lexicon,
    boundaries: dedupeBoundaries([...lexicon.boundaries, { ...boundary, at: now.toISOString() }]),
    updatedAt: now.toISOString(),
  };
}

function sameBoundary(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function dedupeBoundaries(boundaries: readonly LexiconBoundary[]): LexiconBoundary[] {
  const seen = new Map<string, LexiconBoundary>();
  for (const boundary of boundaries) {
    // 74 §3.6.8 — text AND direction. Keyed on text alone, a one-way boundary swallowed the other way's:
    // ruling a name out to HEAR and then to SAY left one record, and taking back the first took both.
    // An undirected boundary keeps its own slot and stays the strictest (it covers both).
    const key = `${boundary.text.trim().toLowerCase()}|${boundary.direction ?? 'both'}`;
    // Keep the FIRST recording of a boundary — its original date is the honest one.
    if (!seen.has(key)) seen.set(key, boundary);
  }
  return [...seen.values()];
}

/**
 * Merge two lexicons (pure). Ratings AND states resolve last-write-wins by `updatedAt`; **boundaries still
 * UNION**, because a theme is named by an explicit act rather than a mark that can be changed.
 *
 * **Its one production caller folds a synthesis back into a lexicon against a copy of ITSELF**
 * (`completeAdaptiveResult`). There is no sync-conflict caller: a conflicted vault copy is surfaced to the
 * person to resolve (`findConflicts` → the banner), never merged automatically.
 *
 * That matters because of what this function cannot express: **a deletion**. `byKey` is seeded from the older
 * copy and the newer one only ever adds to it, so an entry the newer side dropped comes back. Today nothing
 * can trip that — the only deletions are `pruneUnshownMarks`, both sides of the one live call are the same
 * object, and any resurrection would be re-pruned on the next adaptive read. Wire a real two-copy merge and
 * it becomes reachable, and a lifted `never` would come back with it: that needs a tombstone, not a tweak
 * here. Pinned by a test so the limitation is a decision rather than a surprise.
 */
export function mergeLexicons(a: EroticLexicon, b: EroticLexicon): EroticLexicon {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
  const byKey = new Map(older.entries.map((entry) => [entry.key, entry]));
  for (const entry of newer.entries) {
    const prior = byKey.get(entry.key);
    // Last-write-wins, including for `never`. It used to survive from EITHER side so a sync conflict could
    // not lose a hard no -- correct while it was permanent, wrong now that it is a preference: lifting one
    // on this device would be undone by an older copy that still had it.
    const state: LexiconState | undefined = entry.state;
    byKey.set(entry.key, {
      ...entry,
      ...(state ? { state } : {}),
      ...(state === 'never' ? { hear: 0, say: 0 } : {}),
      // `sides` records what was ASKED (74 §3.6.6), and a device on an older build writes entries without
      // it. Spreading the newer entry alone would DROP that record, and an entry with no `sides` is read as
      // both-sides-asked — which turns every loved hear-only entry back into a goal the person never
      // declined. What was asked is not a rating: it cannot be un-known by a later write, so it survives the
      // merge like a boundary does. Newer wins only when it actually has an answer.
      ...((entry.sides ?? prior?.sides) ? { sides: entry.sides ?? prior?.sides } : {}),
    });
  }
  return {
    ...newer,
    entries: [...byKey.values()],
    boundaries: dedupeBoundaries([...older.boundaries, ...newer.boundaries]),
    themes: [...new Set([...older.themes, ...newer.themes])],
    wantsToSay: [...new Set([...older.wantsToSay, ...newer.wantsToSay])],
  };
}

/**
 * Every text a consumer must never produce for this person — the suppression list (74 §5.7/§8.4).
 *
 * `direction` narrows it to lines running one way, which only matters since a name can be marked twice
 * (74 §3.6.8): "never call me slut" must not stop him calling HER slut. **Omitting it keeps the strictest
 * reading** — everything ruled out either way — because a caller that cannot say which way its line runs is
 * exactly the caller that must not be trusted to thread the needle.
 */
export function suppressedTexts(lexicon: EroticLexicon, direction?: 'hear' | 'say'): string[] {
  const fromEntries = lexicon.entries
    .filter((entry) => {
      // A per-direction mark is authoritative for its own side; `state` still covers the whole entry.
      if (entry.state === 'never') return true;
      if (direction === 'hear') return entry.hearState === 'never';
      if (direction === 'say') return entry.sayState === 'never';
      return entry.hearState === 'never' || entry.sayState === 'never';
    })
    .map((entry) => entry.text);
  // A bank entry's suppression comes from its live state ABOVE, never from a record. Lexicons written
  // before 2026-08-19 still carry a `kind:'word'` record per hard no; honouring those would make a lifted
  // preference keep suppressing forever, so an entry-backed word record is ignored here. Nothing has to be
  // migrated: the record is simply no longer the source of truth. A `theme` (named in a probe, not a bank
  // entry) is unaffected, and so is a word boundary with no entry behind it.
  const entryTexts = new Set(lexicon.entries.map((entry) => entry.text.trim().toLowerCase()));
  const fromBoundaries = lexicon.boundaries
    .filter((boundary) => !direction || !boundary.direction || boundary.direction === direction)
    .filter(
      (boundary) => boundary.kind !== 'word' || !entryTexts.has(boundary.text.trim().toLowerCase()),
    )
    .map((boundary) => boundary.text);
  return [...new Set([...fromEntries, ...fromBoundaries])];
}

/** Words that carry no meaning for a theme match. */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'is',
  'it',
  'be',
  'being',
  'been',
  'me',
  'my',
  'you',
  'your',
  'i',
  'am',
  'that',
  'this',
  'with',
  'any',
  'about',
  'anything',
  'as',
]);

/** A crude stem so "used" / "using" / "use" match. Deliberately simple — this is a safety net, not NLP. */
function stem(word: string): string {
  const w = word.toLowerCase();
  // The thresholds matter: "used" (4) and "using" (5) must land on the SAME stem or a themed boundary like
  // "anything about being used" misses "I love using you", which is exactly the case this exists for.
  const dropE = (x: string): string => (x.endsWith('e') && x.length > 2 ? x.slice(0, -1) : x);
  // Suffix first, then a trailing "e", so use / used / using all land on the same stem. Without the second
  // step "used" → "us" and "use" → "use", and a themed boundary misses half the lines it exists to catch.
  if (w.endsWith('ing') && w.length > 4) return dropE(w.slice(0, -3));
  if (w.endsWith('ed') && w.length > 3) return dropE(w.slice(0, -2));
  if (w.endsWith('es') && w.length > 3) return dropE(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3) return dropE(w.slice(0, -1));
  return dropE(w);
}

function contentStems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word !== '' && !STOPWORDS.has(word))
    .map(stem);
}

/**
 * The name families whose entries are **ordinary English** — words that mean something outside being a form
 * of address, so ruling one out cannot mean "never use this word".
 *
 * Opt-IN by family, deliberately. Two earlier shapes were both wrong: enumerating every ordinary WORD is
 * whack-a-mole (the bank has 342 single-word names, and the plain-meaning ones run from `love` and
 * `beautiful` through `princess`, `kitten`, `doll`, `boss`, `captain`, `goose`, `trouble` and `sleepyhead` —
 * miss one and a perfectly good sentence containing it is silently discarded, which is what dropped a
 * generated probe question for someone with 246 hard nos and reported it to them as the model failing); and
 * listing the CRUDE families instead fails OPEN, because a family added to the bank later, or a name written
 * under a family id that isn't in the list, would quietly relax a hard no.
 *
 * So: these families relax to address-only matching, and everything else — `rough-heavy`, `object`,
 * `worthless`, `feminising`, `service`, `sharing`, `breeding`, and any family added tomorrow — keeps the plain
 * substring match, so `whore` in "you filthy whore" is off wherever it sits. Multi-word names ("good girl")
 * keep it too: no innocent use, nothing to disambiguate.
 */
const EVERYDAY_NAME_FAMILIES: ReadonlySet<string> = new Set([
  'names-warm',
  'names-yours',
  'names-praise',
  'names-soft-power',
  'names-hard-power',
  'names-masculine',
  'names-playful',
  'names-aftercare',
  'names-other-tongues',
  'names-petplay',
  'names-kinship',
  'names-roleplay',
]);

/**
 * Whether a candidate line touches a boundary. Two different checks, because the two kinds of boundary are
 * different things:
 *
 * - a **`word`** boundary is a literal — the exact word or phrase they ruled out — so it is a substring match.
 * - a **`theme`** boundary ("anything about being used") is a described idea, which no substring can catch:
 *   "I love using you" contains none of it. So a theme matches when every one of its content words appears in
 *   the candidate, crudely stemmed, which catches the obvious cases without pretending to be semantic.
 *
 * This is the SECOND line of defence. The first is the prompt, which carries every boundary as a hard negative
 * constraint; a theme that slips past both is why the person can always edit their profile.
 */
export function violatesBoundary(
  lexicon: EroticLexicon,
  candidate: string,
  /** Which way this line runs, when the caller knows. Omitted ⇒ refuse anything ruled out either way. */
  direction?: 'hear' | 'say',
): boolean {
  const text = candidate.toLowerCase();
  const stems = new Set(contentStems(candidate));
  // Which banned terms are pet names that are ALSO everyday words. Derived from the bank at match time
  // rather than stored on the boundary, so it applies to every record already written — a name ruled out
  // before this existed needs no migration to stop over-matching.
  const vocatives = new Set(
    lexicon.entries
      .filter((entry) => EVERYDAY_NAME_FAMILIES.has(entry.family))
      .map((entry) => entry.text.trim().toLowerCase())
      // A multi-word name has no innocent use, so it keeps the plain match.
      .filter((text) => !text.includes(' ')),
  );
  const literal = suppressedTexts(lexicon, direction).some((banned) => {
    const needle = banned.trim().toLowerCase();
    if (needle === '') return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /*
     * A single-word PET NAME is only a boundary when it is used to ADDRESS them.
     *
     * Ruling out being called "love" must not suppress every line containing the word love — and dozens of
     * the bank's names are ordinary words (love · baby · beautiful · angel · treasure · honey · sweet).
     * Someone who rules out most of the name bank was, before this, suppressing so much ordinary English
     * that the lines phase filtered out everything it generated and the synthesis discarded whole narratives
     * for containing the word "love". The feature reported that as "nothing usable came back".
     *
     * A MULTI-WORD name ("good girl") keeps the plain substring match: it has no innocent use, so there is
     * nothing to disambiguate and nothing is loosened.
     */
    if (!vocatives.has(needle)) {
      // Word-boundaried, or a short banned word suppresses every line containing it ("ass" → "pass", "class").
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
    }
    // Address: comma-adjacent ("come here, love" / "love, come here"), possessive or exclamatory ("my love",
    // "oh love"), the bare word on its own, or stated as what they ARE ("you're my love").
    return [
      // Opens the line, or follows a comma: "love, come here" · "come here, love".
      new RegExp(`(^|[,;]\\s*)${escaped}([^a-z0-9]|$)`, 'i'),
      // Carries a vocative comma: "that's it baby, just like that". A full stop is NOT enough — "you look
      // beautiful." is a compliment, not a name, and that is exactly the false positive being removed.
      new RegExp(`(^|[^a-z0-9])${escaped}\\s*,`, 'i'),
      // Named as theirs, or as what they are: "my love" · "you're my baby" · "such a doll".
      new RegExp(`\\b(my|oh|hey|you're|youre|such an?|a|an)\\s+${escaped}([^a-z0-9]|$)`, 'i'),
    ].some((re) => re.test(text));
  });
  if (literal) return true;
  return lexicon.boundaries.some((boundary) => {
    if (boundary.kind !== 'theme') return false;
    if (direction && boundary.direction && boundary.direction !== direction) return false;
    const needed = contentStems(boundary.text);
    return needed.length > 0 && needed.every((word) => stems.has(word));
  });
}

/** The entries they love, strongest first, optionally in one direction. Never includes a boundary. */
export function lovedEntries(
  lexicon: EroticLexicon,
  direction: 'hear' | 'say' | 'either' = 'either',
): LexiconEntry[] {
  const value = (entry: LexiconEntry): number =>
    direction === 'hear'
      ? entry.hear
      : direction === 'say'
        ? entry.say
        : Math.max(entry.hear, entry.say);
  // A direction-specific read must ignore entries that direction was never put to (74 §3.6.6). Correctness
  // here currently also depends on `applyBankMarks` not seeding an unshown side — make it explicit rather
  // than rely on the writer, because a merge from an older device copies ratings verbatim.
  const asked = (entry: LexiconEntry): boolean =>
    direction === 'either' || entry.sides === undefined || entry.sides.includes(direction);
  return lexicon.entries
    .filter((entry) => entry.state === undefined && asked(entry) && value(entry) >= 3)
    .sort((x, y) => value(y) - value(x));
}

/**
 * What they marked **"It's okay"** — a mild yes (74 §3.6.2).
 *
 * Not a favourite and never a goal, but it is not nothing either, and it is not the same as unrated: it is
 * the explicit answer "fine, use it". Without this the middle mark was write-only — recorded, restored in the
 * deck, and then invisible on the report and absent from every prompt, so the hundreds of taps a person spends
 * on it bought them nothing (and their own profile silently omitted their own answers).
 *
 * Boundaries are excluded by the `state` check, and a `never` can never hold this state anyway.
 */
export function okayEntries(lexicon: EroticLexicon): LexiconEntry[] {
  return lexicon.entries.filter((entry) => entry.state === 'okay');
}

/**
 * The GOAL list, derived rather than asked: things they clearly want to HEAR but rate low to SAY. That gap is
 * the coachable material the practice session runs on (74 §3.3).
 *
 * **Only when BOTH sides were actually asked** (74 §3.6.6). `say: 0` means "cannot say it", so an entry the
 * orientation only ever offered on the hear side would otherwise become a goal the person never declined —
 * and goals reach their own coach prompt AND a partner-shared Insight fact. A fabricated goal is worse than a
 * missing one. Entries predating orientation carry no `sides` and are treated as both-asked, which is true.
 *
 * The middle mark no longer contributes: `okay` is a mild yes, not a thing they wish they could say (§3.6.2).
 */
export function derivedWantsToSay(lexicon: EroticLexicon): string[] {
  const gap = lexicon.entries
    .filter((entry) => entry.state !== 'never')
    .filter((entry) => bothSidesAnswered(entry) && entry.hear >= 3 && entry.say <= 1)
    .map((entry) => entry.text);
  // Belt and braces on top of the mark guard: a goal is something to PRACTISE, so a suppressed text can
  // never appear here — it would read as encouragement to say the one thing they ruled out.
  return [...new Set([...gap, ...lexicon.wantsToSay])].filter(
    (text) => !violatesBoundary(lexicon, text),
  );
}
