import type { FileSystem } from '../../host';
import { isSafeSegment } from '../../pathSafety';
import {
  EroticLexiconSchema,
  type EroticLexicon,
  type LexiconBoundary,
  type LexiconEntry,
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
 * 1. **Every answer is PER DIRECTION.** A term is marked `love | okay | never` for hearing it and again for
 *    saying it, because the two genuinely differ — wanting to call her "good girl" says nothing about wanting
 *    to be called it. `hear`/`say` (4/2/0) stay derived from those marks, so every consumer keeps reading the
 *    two numbers it always read. Since §3.6.26 the deck works this way too; the whole-entry writer and the
 *    separate 0–4 "split" pass it needed are gone.
 * 2. **A `never` is a PREFERENCE, not a locked door** (§3.2, amended 2026-08-19). It is respected for exactly
 *    as long as it is set: suppression is DERIVED from the live mark by `suppressedTexts`, never from a
 *    second record, so changing your mind takes effect on the next read. The one thing that must never
 *    happen is a mark with no control left to lift it — which is why `clearDirectionalMarks` is not scoped to
 *    the take that wrote it, and why anything that removes an entry removes the boundary record behind it.
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
    if (!parsed.success) return emptyLexicon(personId, now);
    // 74 §3.6.26 — the deck's pre-Option-B answers are cleared HERE, on the one read every consumer goes
    // through, so there is exactly one shape in the app and nothing downstream needs a branch for the old
    // one. It is idempotent and it needs no bank, which is what lets it live this low.
    return resetPreDirectionalDeckMarks(parsed.data, now).lexicon;
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
  return (side === 'hear' ? entry.hearState : entry.sayState) !== undefined;
}

/** Was saying it actually answered? Use wherever a low/zero `say` is read as a signal. */
export function saySideAnswered(entry: LexiconEntry): boolean {
  return directionAnswered(entry, 'say');
}

/** The mirror of {@link saySideAnswered}. A hear-direction signal must not count a say-only entry as a zero. */
export function hearSideAnswered(entry: LexiconEntry): boolean {
  return directionAnswered(entry, 'hear');
}

/**
 * Does this entry carry an answer AT ALL — as opposed to sitting in the lexicon unrated?
 *
 * The obvious test (`state !== undefined || hear > 0 || say > 0`) was right only while a hard no lived in the
 * whole-entry `state`. Since names — and, since §3.6.26, the deck — answer per direction, a `never` on both
 * sides is `state: undefined` with both ratings 0, which that test reads as UNRATED. It is the opposite: a no
 * is an answer, and the spine's own comment says so ("a boundary contributes 0 — it is a no, not a missing
 * answer") while its filter was dropping those entries before the scorer could see them.
 */
export function hasAnswer(entry: LexiconEntry): boolean {
  return entry.hearState !== undefined || entry.sayState !== undefined;
}

/** Were BOTH directions actually answered? The gap between them is only real when they were. */
export function bothSidesAnswered(entry: LexiconEntry): boolean {
  return directionAnswered(entry, 'hear') && directionAnswered(entry, 'say');
}

/**
 * 74 §3.6.26 — the say GAP: they love hearing it, and saying it is a step behind. The one signal the
 * practice sheet, the goal list and the probe are all built on, expressed ONCE so they cannot drift.
 *
 * The numeric test (`hear >= 3 && say <= 1`) only works on a 0–4 scale. Answered per direction the ratings
 * are 4 / 2 / 0, so `say <= 1` can only mean a `never` — and a `never` is a BOUNDARY, not a gap: it
 * suppresses the word, `violatesBoundary` strips it from anything generated, and §3.6.15 forbids the probe
 * from asking anyone to justify one. Reading it as "the most coachable signal in the take" would put the one
 * thing they ruled out in front of them as homework, which is the leak §3.2's goal guard exists to stop.
 *
 * So the gap is love-to-hear against okay-to-say: a real asymmetry, and the only one three marks can express.
 */
export function hasSayGap(entry: LexiconEntry): boolean {
  return bothSidesAnswered(entry) && entry.hearState === 'love' && entry.sayState === 'okay';
}

/** One name's answer: a mark per direction. Either side may be absent — an unanswered side stays unanswered. */
export type DirectionalMark = { hear?: BankMark; say?: BankMark };
export type DirectionalMarks = Record<string, DirectionalMark>;

/** love → 4, okay → 2, never → 0. The ratings stay the currency every existing consumer reads. */
function ratingFor(mark: BankMark | undefined, current: number): number {
  if (mark === 'love') return LOVE_SEED >= 4 ? LOVE_SEED : 4;
  if (mark === 'okay') return 2;
  if (mark === 'never') return 0;
  return current;
}

/**
 * The marking pass, for the pet names AND the deck (74 §3.6.8/§3.6.26) — one entry answered twice, once per
 * direction.
 *
 * The deck used to take ONE mark for the whole entry and then a second pass to split it 0–4. That second
 * pass was folded into the row (§3.6.13) and then, in practice, never reached: it appeared only after a
 * `love`, showed nothing selected over a value that was already set, and sat under copy still promising a
 * step that no longer existed. So `hear` and `say` stayed equal for every deck word, and the hear/say GAP —
 * the goal list, the practice sheet, the "wants to say but freezes" material in their own coach prompt —
 * could only ever fill from the names.
 *
 * The owner's answer (2026-08-19) was to make the deck work like the names: two marks, both on the row,
 * neither hidden behind the other. There is no single answer to split — wanting to call her "good girl"
 * says nothing about wanting to be called it — so both marks arrive together and each writes its own side.
 *
 * Two things it does that the old whole-entry writer did not:
 *
 * 1. **`hear`/`say` stay derived** (love → 4, okay → 2, never → 0), so the spine, the steer, the report and
 *    every other consumer keep reading the two numbers they always read. `hearState`/`sayState` are what the
 *    marking screens read back.
 * 2. **A `never` is per DIRECTION.** "Never call me slut" must not stop him calling her slut, which is the
 *    whole reason `LexiconBoundary.direction` exists.
 */
export function applyDirectionalMarks(
  lexicon: EroticLexicon,
  bank: Bank,
  marks: DirectionalMarks,
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
export function clearDirectionalMarks(
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

/**
 * 74 §3.6.26 — the deck's old 0–4 answers, cleared (owner decision, 2026-08-19).
 *
 * The deck used to take ONE mark per entry and then a 0–4 split to pull the two directions apart. Option B
 * replaces both with the pet names' model: a `love | okay | never` per direction, marked on the row. The old
 * answers cannot be carried across honestly. Measured on the real vault before deciding: the owner's 132 deck
 * entries carry no `love`/`okay`/`never` at all — they are pure ratings, 119 of them with `hear ≠ say` — so
 * seeding the new columns from `state` (which is what the two written-up options assumed) would have shown
 * every one of those marks as blank. Deriving them from the ratings instead runs into a worse problem: a `0`
 * on a side they WERE offered is genuinely ambiguous between "I dialled it down" and "I never touched it",
 * and reading it as a hard no would invent ~20 app-wide suppressions nobody declared. Asked, and the answer
 * was to clear the deck and start it fresh.
 *
 * So a deck entry with no per-direction state is pre-B and its answer goes. Three things make that safe:
 *
 * - **Scoped to THIS bank's deck families** (`phase !== 'names'`), so the pet names — the bulk of the real
 *   marking, and answered in the new model already — are untouched, and so is any other instrument sharing
 *   the lexicon.
 * - **A custom write-in keeps its word.** The owner asked to remove the deck's DATA; a word the person typed
 *   themselves was never the bank's to delete, so its ratings clear and the entry stays. (Without this the
 *   migration would eat a word the moment `addCustomEntry` created it — a fresh custom entry is 0/0 with no
 *   state, which is exactly the shape being purged.)
 * - **A word boundary left behind is removed with it.** This is the one that bites: `suppressedTexts`
 *   ignores a legacy `kind:'word'` record only while an entry with that text still exists, so dropping the
 *   entry and keeping the record would silently REACTIVATE that suppression app-wide with nothing on any
 *   screen left to lift it — the un-gettable-rid-of preference §3.2 abolished, arrived at through a cleanup.
 *   Measured: 0 such records for the owner, 4 for the other member, so it is small and it is real.
 *
 * Idempotent: the second run finds nothing to do and reports `changed: false`, so it never writes on a read.
 */
export function resetPreDirectionalDeckMarks(
  lexicon: EroticLexicon,
  now: Date,
): { lexicon: EroticLexicon; changed: boolean } {
  /*
   * An entry with NO per-direction mark carries no answer. Every marking phase writes one — the names since
   * §3.6.8, the deck since §3.6.26 — so this is exactly the pre-Option-B deck shape, whether it was stored as
   * a rating (a `love`, split or not) or as the retired whole-entry `state` (an `okay`/`never`, which stored
   * 0/0 and put the answer in a field that no longer exists). No bank is needed to recognise it, which is
   * what lets this run inside `readLexicon` so no consumer anywhere sees the old shape.
   */
  const isPreDirectional = (entry: LexiconEntry): boolean =>
    entry.hearState === undefined && entry.sayState === undefined;

  const norm = (text: string): string => text.trim().toLowerCase();
  const cleared = new Set<string>();
  const entries: LexiconEntry[] = [];
  let changed = false;
  for (const entry of lexicon.entries) {
    if (!isPreDirectional(entry)) {
      entries.push(entry);
      continue;
    }
    cleared.add(norm(entry.text));
    if (!entry.custom) {
      // A bank word: the row comes back from the bank, so the entry itself can just go.
      changed = true;
      continue;
    }
    // Their own word stays; only the answer goes. Already-clear is a no-op, or this would write on every read.
    if (entry.hear === 0 && entry.say === 0) entries.push(entry);
    else {
      entries.push({ ...entry, hear: 0, say: 0 });
      changed = true;
    }
  }
  // Only a record with nothing left behind it. A text that survives on another entry (a name that shares a
  // word with a deck line) is still governed by that entry's own mark, so its record stays ignored either way.
  const surviving = new Set(entries.map((entry) => norm(entry.text)));
  const boundaries = lexicon.boundaries.filter(
    (boundary) =>
      boundary.kind !== 'word' ||
      !cleared.has(norm(boundary.text)) ||
      surviving.has(norm(boundary.text)),
  );
  if (boundaries.length !== lexicon.boundaries.length) changed = true;
  if (!changed) return { lexicon, changed: false };
  return {
    lexicon: { ...lexicon, entries, boundaries, updatedAt: now.toISOString() },
    changed: true,
  };
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
    // Last-write-wins, including for a `never`. It used to survive from EITHER side so a sync conflict could
    // not lose a hard no -- correct while it was permanent, wrong now that it is a preference: lifting one
    // on this device would be undone by an older copy that still had it.
    byKey.set(entry.key, {
      ...entry,
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
  // here currently also depends on the writer not seeding an unshown side — make it explicit rather
  // than rely on the writer, because a merge from an older device copies ratings verbatim.
  const asked = (entry: LexiconEntry): boolean =>
    direction === 'either' || entry.sides === undefined || entry.sides.includes(direction);
  return lexicon.entries
    .filter((entry) => asked(entry) && value(entry) >= 3)
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
 * Per direction since §3.6.26: "fine to hear" and "fine to say" are separate answers, and an entry counts
 * here when either of them is the middle mark. A `never` on the other side does not disqualify it — that
 * side is simply ruled out, and suppression is what carries that, not this list.
 */
export function okayEntries(lexicon: EroticLexicon): LexiconEntry[] {
  return lexicon.entries.filter((entry) => entry.hearState === 'okay' || entry.sayState === 'okay');
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
  /*
   * 74 §3.6.26 — the gap, in the vocabulary each entry was actually answered in.
   *
   * The numeric test (`hear >= 3 && say <= 1`) only works on a 0–4 scale. Marked per direction the ratings
   * are 4 / 2 / 0, so `say <= 1` can ONLY mean a `never` — which `violatesBoundary` then strips below,
   * because a hard no must never read as something to practise. Net effect: nothing can qualify. That was
   * already true of the pet names, which have been answered this way all along (measured on the real vault:
   * every entry this fired for came from the deck, none from the names), and §3.6.26 would have extended it
   * to the deck too and left the goal list, the practice sheet and the coach's "wants to say" material
   * permanently empty.
   *
   * So the gap is the only asymmetry three marks can express: they LOVE hearing it, and saying it is merely
   * okay. A softer signal than a 1-out-of-4 was, and a real one.
   */
  const gap = lexicon.entries.filter(hasSayGap).map((entry) => entry.text);
  // Belt and braces on top of the mark guard: a goal is something to PRACTISE, so a suppressed text can
  // never appear here — it would read as encouragement to say the one thing they ruled out.
  return [...new Set([...gap, ...lexicon.wantsToSay])].filter(
    (text) => !violatesBoundary(lexicon, text),
  );
}
