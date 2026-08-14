import type { FileSystem } from '../host';
import { uuid } from '../id';
import { getPerson } from '../people';
import { recordAuthorDrift } from './storyMaterial';
import type { ExclusionItem, ExclusionKind } from '../schemas';
import { getExclusions, listChapters, saveExclusions } from './storyService';

/**
 * Your Story exclusions (64-your-story §3.3/§5.1) — the durable "never write about this again" list. Adding an
 * exclusion filters the material at the CORPUS boundary (`storyCorpus`, so no future generation can reintroduce
 * it) AND — the owner's 2026-07-16 decision (option 1) — marks any ALREADY-WRITTEN chapter that still mentions
 * the excluded thing **stale**, so the person (or the Phase-D auto-refresh) rewrites it clean when ready. It
 * never auto-regenerates (no surprise AI spend) and never touches reviewed prose without the person's action.
 *
 * `value` by kind (§4): `topic`/`passage` = the text to avoid (substring-matched); `person` = the person id
 * (resolved to their display name to scan existing prose); `source` = a `StorySourceRef` id.
 */

/** File a proposal against every chapter that still contains the excluded material. Returns how many. */
async function flagAffectedChapters(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  item: ExclusionItem,
  now?: Date,
): Promise<number> {
  // Resolve a text needle for text-scanned kinds; a `source` exclusion matches on provenance ids instead.
  let needle: string | null = null;
  if (item.kind === 'passage' || item.kind === 'topic') {
    needle = item.value.trim();
  } else if (item.kind === 'person') {
    const p = await getPerson(fs, key, item.value);
    needle = p ? p.displayName.trim() : null;
  }
  if (item.kind !== 'source' && (!needle || needle.length === 0)) return 0;
  // Match on WORD BOUNDARIES, not a raw substring — staling written (possibly reviewed) prose is higher-stakes
  // than the corpus-boundary filter, so a short topic/name ("war", "Al") must not flag "warm"/"always".
  const matcher = needle !== null ? new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i') : null;

  let count = 0;
  for (const chapter of await listChapters(fs, key, personId, bookId)) {
    if (chapter.status === 'generating') continue; // never disturb one mid-generation
    const affected =
      item.kind === 'source'
        ? chapter.provenance.some((entry) => entry.refs.some((r) => r.id === item.value))
        : matcher !== null && matcher.test(chapter.markdown);
    if (affected) {
      // A proposal, not a rewrite (72 §4.4). Excluding something is an instruction about the FUTURE; the
      // prose already written still contains it, and taking it out costs a metered pass — so the author is
      // shown which chapters are affected and rewrites them when they choose.
      await recordAuthorDrift(fs, key, personId, bookId, {
        chapterId: chapter.id,
        reason: 'sourceRemoved',
        note: `This chapter draws on something you’ve since excluded${
          needle ? ` (“${needle}”)` : ''
        }.`,
        now: now ?? new Date(),
      });
      count += 1;
    }
  }
  return count;
}

/** Escape a user string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Add an exclusion (§3.3): persist it + mark already-written chapters that mention it stale (option 1). Returns
 * the updated list + how many chapters were flagged. Ids/timestamps are minted here (never trusted from the UI).
 */
export async function addExclusion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  input: { kind: ExclusionKind; value: string; note?: string },
  now: Date,
): Promise<{ exclusions: ExclusionItem[]; staled: number }> {
  const value = input.value.trim();
  const items = await getExclusions(fs, key, personId, bookId);
  // A blank value would persist a dead rule (a blank overview row); a same-kind duplicate would stack rows —
  // in both cases return the current list unchanged rather than write a useless entry.
  if (value.length === 0) return { exclusions: items, staled: 0 };
  if (items.some((i) => i.kind === input.kind && i.value === value)) {
    return { exclusions: items, staled: 0 };
  }
  const item: ExclusionItem = {
    id: uuid(),
    kind: input.kind,
    value,
    ...(input.note && input.note.trim().length > 0 ? { note: input.note.trim() } : {}),
    createdAt: now.toISOString(),
  };
  const exclusions = [...items, item];
  await saveExclusions(fs, key, personId, bookId, exclusions);
  const staled = await flagAffectedChapters(fs, key, personId, bookId, item);
  return { exclusions, staled };
}

/** Remove an exclusion (§3.3). Written chapters are left as they are — removing a "never write about this"
 *  rule doesn't retroactively rewrite anything; future generations simply stop filtering it. */
export async function removeExclusion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  itemId: string,
): Promise<ExclusionItem[]> {
  const items = await getExclusions(fs, key, personId, bookId);
  const exclusions = items.filter((i) => i.id !== itemId);
  await saveExclusions(fs, key, personId, bookId, exclusions);
  return exclusions;
}
