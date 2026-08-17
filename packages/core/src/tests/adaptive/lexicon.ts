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
    // A boundary is unliftable by ANY mark — not just by `love`. Downgrading it to `notYet` used to leave the
    // word in `derivedWantsToSay`, which puts it in their own coach prompt as a GOAL two lines under "never
    // use this", and in a partner-shared Insight fact. A `never` lifts only through `clearState`.
    //
    // LOAD-BEARING BEYOND THIS FUNCTION: because this `continue` runs BEFORE the write below, a boundary
    // entry can never be re-stamped with a newer take's `source` — which is the only reason `clearMarks`'s
    // source scoping cannot be walked around by re-marking a hard no and then clearing it. Deleting this
    // line silently unlocks un-marking someone else's settled boundary too.
    if (existing?.state === 'never') continue;
    const shownSides = sidesByKey[key];
    // Record what was ASKED, so a `0` on a side that was never offered is distinguishable from a refusal.
    const withSides = shownSides ? { sides: [...shownSides] } : {};
    const base = { ...(existing ?? toLexiconEntry(spec as BankEntry, source)), ...withSides };
    if (mark === 'love') {
      // Seed ONLY when there is nothing to preserve. Re-sending the whole pass (which closing it does) would
      // otherwise reset a hear:4/say:1 split back to 3/3 — and quitting between the two passes, which the
      // autosave copy actively encourages, is exactly when that lands and never gets repaired.
      const seeded = base.hear === 0 && base.say === 0;
      byKey.set(key, {
        ...base,
        ...(seeded ? { hear: LOVE_SEED, say: LOVE_SEED } : {}),
        state: undefined,
        source,
      });
    } else {
      byKey.set(key, { ...base, hear: 0, say: 0, state: mark, source });
      if (mark === 'never') {
        // A bank boundary is a LITERAL text to suppress, whether it is one word or a whole phrase; `theme`
        // is reserved for a described boundary a probe named ("anything about being used").
        boundaries.push({ text: base.text, kind: 'word', at: now.toISOString() });
      }
    }
  }
  return {
    ...lexicon,
    entries: [...byKey.values()],
    boundaries: dedupeBoundaries(boundaries),
    updatedAt: now.toISOString(),
  };
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
  source: string,
): EroticLexicon {
  if (keys.length === 0) return lexicon;
  const wanted = new Set(keys);
  const clearable = (entry: LexiconEntry): boolean =>
    wanted.has(entry.key) && entry.source === source;
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
    const key = boundary.text.trim().toLowerCase();
    // Keep the FIRST recording of a boundary — its original date is the honest one.
    if (!seen.has(key)) seen.set(key, boundary);
  }
  return [...seen.values()];
}

/**
 * Merge two lexicons (pure) — the sync-conflict + retake path. Ratings resolve last-write-wins by
 * `updatedAt`, but **a `never` on EITHER side wins** and **boundaries UNION**, so no merge can lose a hard no.
 */
export function mergeLexicons(a: EroticLexicon, b: EroticLexicon): EroticLexicon {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
  const byKey = new Map(older.entries.map((entry) => [entry.key, entry]));
  for (const entry of newer.entries) {
    const prior = byKey.get(entry.key);
    // A hard no from either side survives the merge, whichever side is newer.
    const state: LexiconState | undefined =
      prior?.state === 'never' || entry.state === 'never' ? 'never' : entry.state;
    byKey.set(entry.key, {
      ...entry,
      ...(state ? { state } : {}),
      ...(state === 'never' ? { hear: 0, say: 0 } : {}),
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

/** Every text a consumer must never produce for this person — the suppression list (74 §5.7/§8.4). */
export function suppressedTexts(lexicon: EroticLexicon): string[] {
  const fromEntries = lexicon.entries
    .filter((entry) => entry.state === 'never')
    .map((entry) => entry.text);
  const fromBoundaries = lexicon.boundaries.map((boundary) => boundary.text);
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
export function violatesBoundary(lexicon: EroticLexicon, candidate: string): boolean {
  const text = candidate.toLowerCase();
  const stems = new Set(contentStems(candidate));
  const literal = suppressedTexts(lexicon).some((banned) => {
    const needle = banned.trim().toLowerCase();
    if (needle === '') return false;
    // Word-boundaried, or a short banned word suppresses every line containing it ("ass" → "pass", "class").
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  });
  if (literal) return true;
  return lexicon.boundaries.some((boundary) => {
    if (boundary.kind !== 'theme') return false;
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
  return lexicon.entries
    .filter((entry) => entry.state === undefined && value(entry) >= 3)
    .sort((x, y) => value(y) - value(x));
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
    .filter((entry) => bothSidesAsked(entry) && entry.hear >= 3 && entry.say <= 1)
    .map((entry) => entry.text);
  // Belt and braces on top of the mark guard: a goal is something to PRACTISE, so a suppressed text can
  // never appear here — it would read as encouragement to say the one thing they ruled out.
  return [...new Set([...gap, ...lexicon.wantsToSay])].filter(
    (text) => !violatesBoundary(lexicon, text),
  );
}
