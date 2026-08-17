import type { LexiconEntry } from '../../schemas';

/**
 * 74-adaptive-tests §4.2/§13 — the **bank**: the deterministic, free, instant half of an adaptive test.
 *
 * A bank is a large inventory of words AND the phrases people actually say, grouped into families and
 * carrying an intensity `tier` 1 (tame) → 5 (extreme) — deliberately the same `{ key, label, category, tier }`
 * shape as spec 49's activity inventory, so the two group, order and render the same way.
 *
 * **Nothing is gated** (74 §3.2, owner decision): no tier ceiling, no family opt-in, no hidden families. What
 * stays is the content standard, not a gate — taboo material is worded as pre-agreed, safeworded roleplay, and
 * the hard limits (consensual adults; never minors, real non-consent, or illegal acts) are absolute.
 *
 * **Keys are stable slugs** (the 46 §4.2 rule): a relabel must never orphan a rating, so the key — not the
 * text — is what a `LexiconEntry` is stored against.
 *
 * PURE: no I/O, no AI, no crypto. Render/synthesis-layer code, never per-person vault data.
 */

/** Which direction an entry can sensibly be rated in. Most are both; a few only make sense one way. */
export type BankDirection = 'hear' | 'say';

/**
 * 74 §3.6.3 — the two orientation axes. Both are OPTIONAL on an entry and both fail **open**: absent means
 * "applies to anyone", and `either` matches every person. Nothing here is a boundary — it decides only what a
 * given person is SHOWN, and changing the answer re-shows everything (§3.6.3).
 */
export type BankAddress = 'girl' | 'man' | 'either';
export type BankBody = 'penis' | 'vulva' | 'either';

export interface BankFamily {
  id: string;
  label: string;
  /** Whether this family's entries are single words or whole phrases (drives grouping + the synthesis). */
  kind: 'word' | 'phrase';
  /** The directions this family's entries are rated in (default both). */
  directions: readonly BankDirection[];
  /** Shown under the family heading — the framing an entry list can't carry on its own. */
  note?: string;
  /** Default orientation for the family's entries; an entry may override either axis (§3.6.3). */
  addresses?: BankAddress;
  body?: BankBody;
  /**
   * 74 §3.6.8 — which phase marks this family. Absent ⇒ the deck, which is every family that existed before
   * pet names became their own phase. `'names'` families are answered TWICE (call me / call them) in the
   * phase that runs first, and never appear in the deck.
   *
   * One bank, two phases — rather than two banks — so suppression, the lexicon, the spine and the ask ledger
   * all keep working over a single set of entries.
   */
  phase?: 'names';
}

export interface BankEntry {
  key: string;
  text: string;
  kind: 'word' | 'phrase';
  family: string;
  tier: 1 | 2 | 3 | 4 | 5;
  directions: readonly BankDirection[];
  /**
   * One short line showing the term in use (74 §3.6.1 #1). Present on FRAGMENTS — a bare `hole` or `mine` is
   * a vocabulary item you can't react to. Absent on entries that are already a complete utterance, where an
   * example would just restate the entry.
   */
  example?: string;
  /** Who the line is aimed at. Absent ⇒ anyone. */
  addresses?: BankAddress;
  /** Whose anatomy it names. Absent ⇒ nobody's. */
  body?: BankBody;
}

/** Deterministic, stable slug — mirrors `slug()` in `intimacy/topics.ts` so the two read the same way. */
export function bankSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * One entry in a tier: either the bare text (inherits everything from its family) or an object carrying its
 * example and any per-entry orientation override. The bare form stays valid so ~1,000 existing declarations
 * are untouched, and enrichment is incremental.
 */
export type TierItem =
  | string
  | {
      text: string;
      /** The §3.6.1 #1 example. Omit on entries that are already a complete utterance. */
      ex?: string;
      addresses?: BankAddress;
      body?: BankBody;
    };

/** Per-tier entries for one family. A tier with no entries is simply omitted. */
export type TierTexts = Partial<Record<1 | 2 | 3 | 4 | 5, readonly TierItem[]>>;

/**
 * Declare a family + its tiered entries. The family id prefixes every key, so the same phrase can appear in
 * two families (e.g. "taste me" in Demands and in Taste & fluids) without colliding.
 */
export function bankFamily(
  family: BankFamily,
  tiers: TierTexts,
): { family: BankFamily; entries: BankEntry[] } {
  const entries: BankEntry[] = [];
  for (const tier of [1, 2, 3, 4, 5] as const) {
    for (const item of tiers[tier] ?? []) {
      const spec = typeof item === 'string' ? { text: item } : item;
      // Orientation resolves entry-first, then family, then absent (= applies to anyone). Conditional spreads
      // because `exactOptionalPropertyTypes` treats an explicit `undefined` as a different type from absent.
      const addresses = spec.addresses ?? family.addresses;
      const body = spec.body ?? family.body;
      entries.push({
        key: `${family.id}:${bankSlug(spec.text)}`,
        text: spec.text,
        kind: family.kind,
        family: family.id,
        tier,
        directions: family.directions,
        ...(spec.ex ? { example: spec.ex } : {}),
        ...(addresses ? { addresses } : {}),
        ...(body ? { body } : {}),
      });
    }
  }
  return { family, entries };
}

/** A whole bank: its families in display order + every entry, flattened. */
export interface Bank {
  families: readonly BankFamily[];
  entries: readonly BankEntry[];
}

export function buildBank(blocks: readonly { family: BankFamily; entries: BankEntry[] }[]): Bank {
  return {
    families: blocks.map((b) => b.family),
    entries: blocks.flatMap((b) => b.entries),
  };
}

/**
 * The families the DECK asks (74 §3.6.8) — everything that is not marked as a pet-name family.
 *
 * Both halves of this split live here, next to each other, because a family appearing in neither phase or in
 * both is the kind of bug that looks like missing content rather than a routing mistake.
 */
export function deckFamilies(bank: Bank): BankFamily[] {
  return bank.families.filter((family) => family.phase !== 'names');
}

/** The families the PET-NAME phase asks. */
export function nameFamilies(bank: Bank): BankFamily[] {
  return bank.families.filter((family) => family.phase === 'names');
}

/** Entries grouped by family, in the bank's family order. */
export function bankByFamily(bank: Bank): Map<string, BankEntry[]> {
  const out = new Map<string, BankEntry[]>();
  for (const family of bank.families) out.set(family.id, []);
  for (const entry of bank.entries) out.get(entry.family)?.push(entry);
  return out;
}

/** One entry by key, or undefined (an unknown key is a custom write-in or a retired entry). */
export function bankEntry(bank: Bank, key: string): BankEntry | undefined {
  return bank.entries.find((entry) => entry.key === key);
}

/** A fresh, unrated `LexiconEntry` for a bank entry — the shape a rating is stored in. */
export function toLexiconEntry(entry: BankEntry, source: string): LexiconEntry {
  return {
    key: entry.key,
    text: entry.text,
    kind: entry.kind,
    family: entry.family,
    tier: entry.tier,
    hear: 0,
    say: 0,
    source,
  };
}
