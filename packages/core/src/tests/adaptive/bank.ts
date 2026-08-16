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

export interface BankFamily {
  id: string;
  label: string;
  /** Whether this family's entries are single words or whole phrases (drives grouping + the synthesis). */
  kind: 'word' | 'phrase';
  /** The directions this family's entries are rated in (default both). */
  directions: readonly BankDirection[];
  /** Shown under the family heading — the framing an entry list can't carry on its own. */
  note?: string;
}

export interface BankEntry {
  key: string;
  text: string;
  kind: 'word' | 'phrase';
  family: string;
  tier: 1 | 2 | 3 | 4 | 5;
  directions: readonly BankDirection[];
}

/** Deterministic, stable slug — mirrors `slug()` in `intimacy/topics.ts` so the two read the same way. */
export function bankSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Per-tier entry text for one family. A tier with no entries is simply omitted. */
export type TierTexts = Partial<Record<1 | 2 | 3 | 4 | 5, readonly string[]>>;

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
    for (const text of tiers[tier] ?? []) {
      entries.push({
        key: `${family.id}:${bankSlug(text)}`,
        text,
        kind: family.kind,
        family: family.id,
        tier,
        directions: family.directions,
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
