import type { BankAddress, BankBody, BankDirection, BankEntry } from './bank';

/**
 * 74-adaptive-tests §3.6.3 — **orientation**: which side of a line a given person could actually be on.
 *
 * A straight man was being asked whether he wants to HEAR "your cunt" and whether he wants to be called
 * "good girl". Roughly half the bank could never be said to him or by him, and rating it is noise at best.
 *
 * Two axes, each resolved per direction:
 *
 * - **body** — whose anatomy the line names. From the intake anatomy answers, NEVER inferred from gender +
 *   orientation: that inference is exactly what broke #62 (it conflated who-you-date with what-they-have,
 *   was wrong for trans and non-binary people, and orphaned ratings when someone edited their gender).
 * - **address** — who the line calls you. Anatomy cannot decide this; a trans woman may absolutely want
 *   "good girl". Asked directly, in two taps at the top of the take.
 *
 * **This is a display filter and nothing else.** It writes no mark, lifts no boundary, and suppresses nothing
 * downstream. Changing an answer re-shows everything and loses nothing — which is the whole difference between
 * this and a `never`, and why it can afford to fail open.
 *
 * PURE: no I/O, no AI, no crypto.
 */

/** What a person answered on each axis, for themselves and for the person they're talking to. */
export interface Orientation {
  selfAddress: BankAddress;
  partnerAddress: BankAddress;
  selfBody: BankBody;
  partnerBody: BankBody;
}

/** Everything unknown ⇒ `either` everywhere ⇒ nothing is withheld. The safe default in every direction. */
export const OPEN_ORIENTATION: Orientation = {
  selfAddress: 'either',
  partnerAddress: 'either',
  selfBody: 'either',
  partnerBody: 'either',
};

/**
 * The intake answers are LABELS, not enums (`activityRows` reads the same strings), so the mapping lives here
 * and is deliberately total: anything non-committal or unrecognized — `Rather not say`, `Both or intersex`,
 * `Don't mind`, unset, a future relabel — resolves to `either`, i.e. **fails open**.
 *
 * Withholding by default would give someone who declined to answer a quietly thinner test with no way to know
 * why, which is the exact failure §3.6.5 exists to prevent. It mirrors `resolveOral`'s "never guess → neutral".
 */
export function bodyFromAnatomyAnswer(answer: string | undefined): BankBody {
  const normalized = (answer ?? '').toLowerCase();
  if (normalized.includes('penis')) return 'penis';
  if (normalized.includes('vulva')) return 'vulva';
  return 'either';
}

/** Same posture for the address answer: only an explicit `girl`/`man` narrows anything. */
export function addressFromAnswer(answer: string | undefined): BankAddress {
  const normalized = (answer ?? '').toLowerCase();
  if (normalized === 'girl' || normalized === 'man') return normalized;
  return 'either';
}

function addressMatches(entry: BankAddress | undefined, person: BankAddress): boolean {
  if (entry === undefined || entry === 'either') return true;
  return person === 'either' || person === entry;
}

function bodyMatches(entry: BankBody | undefined, person: BankBody): boolean {
  if (entry === undefined || entry === 'either') return true;
  return person === 'either' || person === entry;
}

/**
 * Which sides this person could be on for this entry.
 *
 * - **hear** — the line is aimed at ME: it addresses me and names my body (or names nobody's).
 * - **say** — the line is aimed at THEM.
 *
 * An empty result means the entry belongs to neither of them, and it is **withheld, counted and stated**
 * (§3.6.5) — never silently dropped. An entry's own `directions` still bound the result, so a family that
 * only makes sense one way stays that way.
 */
export function shownSides(entry: BankEntry, who: Orientation): BankDirection[] {
  const sides: BankDirection[] = [];
  if (
    entry.directions.includes('hear') &&
    addressMatches(entry.addresses, who.selfAddress) &&
    bodyMatches(entry.body, who.selfBody)
  ) {
    sides.push('hear');
  }
  if (
    entry.directions.includes('say') &&
    addressMatches(entry.addresses, who.partnerAddress) &&
    bodyMatches(entry.body, who.partnerBody)
  ) {
    sides.push('say');
  }
  return sides;
}

export interface OrientedEntry {
  entry: BankEntry;
  sides: BankDirection[];
}

export interface OrientedArea {
  familyId: string;
  shown: OrientedEntry[];
  /** How many of this area's entries reach neither side. Stated on screen with a route back (§3.6.5). */
  withheld: number;
}

/**
 * Orient one area. `shown.length + withheld === entries.length` always holds — the count comes from here
 * rather than from the renderer counting empty rows, so the note and the rows can never disagree.
 */
export function orientArea(
  familyId: string,
  entries: readonly BankEntry[],
  who: Orientation,
): OrientedArea {
  const shown: OrientedEntry[] = [];
  let withheld = 0;
  for (const entry of entries) {
    const sides = shownSides(entry, who);
    if (sides.length === 0) withheld += 1;
    else shown.push({ entry, sides });
  }
  return { familyId, shown, withheld };
}
