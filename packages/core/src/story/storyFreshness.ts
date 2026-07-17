import type { FileSystem } from '../host';
import type { BookChapter } from '../schemas';
import { buildStoryCorpus, type StoryCorpus } from './storyCorpus';
import { getExclusions, listChapters, saveChapter } from './storyService';

/**
 * The Your Story freshness engine (64-your-story §3.4/§5.4) — the DETERMINISTIC, no-AI half of the living book.
 * Each chapter carries a `sourceSignature`: a fingerprint of the CURRENT text of the sources it drew on. When a
 * cited source changes (an insight edited, a new fact added, a source deleted/muted), the signature no longer
 * matches and the chapter is flagged `stale` — cheap, so it can run on a launch/focus cadence (the AI rewrite
 * of a stale chapter is the metered, weekly-capped step, D2). New material that doesn't fit any chapter is a
 * structural proposal (D3), not a signature change.
 */

/** A tiny, stable, non-cryptographic string hash (djb2). A change detector for source content — not security. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** The set of source ids a chapter drew on (from its provenance), deduped. */
export function citedSourceIds(chapter: Pick<BookChapter, 'provenance'>): string[] {
  const ids = new Set<string>();
  for (const entry of chapter.provenance) for (const ref of entry.refs) ids.add(ref.id);
  return [...ids];
}

/**
 * Compute a chapter's freshness fingerprint from the CURRENT text of the sources it cited (§5.4). Deterministic:
 * the same cited sources with the same content always hash the same; a changed source's text (or its absence)
 * changes the fingerprint. A chapter that cited nothing specific has an empty signature (it can't go stale from
 * a source change). Fact order within a source is normalized so re-ordering never falsely stales.
 */
export function computeSourceSignature(
  corpus: StoryCorpus,
  chapter: Pick<BookChapter, 'provenance'>,
): string {
  const byId = new Map<string, string[]>();
  for (const item of corpus.items) {
    const arr = byId.get(item.sourceRef.id) ?? [];
    arr.push(item.text);
    byId.set(item.sourceRef.id, arr);
  }
  const ids = citedSourceIds(chapter);
  if (ids.length === 0) return '';
  return ids
    .sort()
    .map((id) => {
      const texts = byId.get(id);
      return texts ? `${id}:${hashString(texts.sort().join(''))}` : `${id}:∅`;
    })
    .join('|');
}

/**
 * Flag every chapter whose cited sources have changed since it was written `stale` (§3.4). Builds the corpus
 * ONCE, recomputes each chapter's signature against it, and stales the ones that drifted. Never re-flags an
 * already-stale chapter, never disturbs one mid-generation, and never stales a chapter with no stored signature
 * (it was written before the freshness engine, or cited nothing). Returns how many it flagged.
 */
export async function markStaleChapters(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<number> {
  const corpus = await buildStoryCorpus(
    fs,
    key,
    personId,
    bookId,
    await getExclusions(fs, key, personId, bookId),
  );
  let count = 0;
  for (const chapter of await listChapters(fs, key, personId, bookId)) {
    if (chapter.status === 'stale' || chapter.status === 'generating') continue;
    if (chapter.sourceSignature === '') continue; // never stamped / cited nothing → nothing to diff
    if (computeSourceSignature(corpus, chapter) !== chapter.sourceSignature) {
      await saveChapter(fs, key, personId, bookId, { ...chapter, status: 'stale' });
      count += 1;
    }
  }
  return count;
}
