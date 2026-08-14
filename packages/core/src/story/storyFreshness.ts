import type { FileSystem } from '../host';
import type { BookChapter, NewMaterialEntry, NewMaterialItem } from '../schemas';
import { buildStoryCorpus, type StoryCorpus } from './storyCorpus';
import { recordNewMaterial } from './storyMaterial';
import { getExclusions, listChapters } from './storyService';

/**
 * The book freshness engine (72 §5.4) — the DETERMINISTIC, no-AI half of the living book.
 *
 * Each chapter carries a `sourceSignature`: a fingerprint of the CURRENT text of the sources it drew on. When
 * a cited source changes (an insight edited, a new fact added, a source deleted or muted), the signature no
 * longer matches. It is cheap, so it runs on a launch/focus cadence.
 *
 * What changed in 72: the OUTPUT. It used to set `status: 'stale'`, which the refresh cadence then acted on by
 * rewriting the chapter — so a person's book quietly re-wrote itself, capped at ten rewrites a week, and a
 * 45-chapter book reached 34 of 34 stale with nothing converging. Now it names WHICH sources changed and WHAT
 * they say, and files that as a proposal the author accepts or declines. Nothing is rewritten without them.
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

/** Parse a stored signature back into its per-source hashes, so a diff can name WHICH sources changed
 *  rather than only that something did. An empty or malformed signature yields an empty map (no claim). */
function parseSignature(signature: string): Map<string, string> {
  const out = new Map<string, string>();
  if (signature.trim().length === 0) return out;
  for (const part of signature.split('|')) {
    const at = part.lastIndexOf(':');
    if (at <= 0) continue;
    out.set(part.slice(0, at), part.slice(at + 1));
  }
  return out;
}

/** How much of a changed source to quote back to the author — enough to judge it by, never the whole thing. */
const EXCERPT_CHARS = 220;

function excerpt(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= EXCERPT_CHARS
    ? trimmed
    : `${trimmed.slice(0, EXCERPT_CHARS).trimEnd()}…`;
}

/**
 * Find every chapter whose cited sources have changed since it was written, and file WHAT changed as a
 * proposal (§4.4/§5.4). Builds the corpus ONCE and diffs each chapter's stored per-source hashes against it,
 * so the entry can name the sources and quote them.
 *
 * Never disturbs a chapter mid-generation, never looks at one with no stored signature (written before the
 * engine, or cited nothing specific), and never touches a chapter's status — drift is a proposal now, not a
 * state. Returns how many chapters have new material waiting.
 */
export async function detectNewMaterial(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  now: Date,
): Promise<number> {
  const corpus = await buildStoryCorpus(
    fs,
    key,
    personId,
    bookId,
    await getExclusions(fs, key, personId, bookId),
  );
  // One source can emit SEVERAL corpus items (an insight's summary and each of its facts), and the signature
  // hashes them together — so the diff knows the source changed but not which line. Join them, so the
  // excerpt shows what the source now says rather than whichever line happened to come first (its summary,
  // which is the one line least likely to be what changed).
  const byId = new Map<
    string,
    { label: string; texts: string[]; ref: NewMaterialItem['sourceRef'] }
  >();
  for (const item of corpus.items) {
    const found = byId.get(item.sourceRef.id);
    if (found) found.texts.push(item.text);
    else
      byId.set(item.sourceRef.id, { label: item.label, texts: [item.text], ref: item.sourceRef });
  }

  const entries: NewMaterialEntry[] = [];
  for (const chapter of await listChapters(fs, key, personId, bookId)) {
    if (chapter.status === 'generating') continue;
    if (chapter.sourceSignature === '') continue; // never stamped / cited nothing → nothing to diff
    const before = parseSignature(chapter.sourceSignature);
    const after = parseSignature(computeSourceSignature(corpus, chapter));
    const changed = [...after.entries()]
      .filter(([id, hash]) => before.get(id) !== hash)
      .map(([id]) => id);
    if (changed.length === 0) continue;

    const items: NewMaterialItem[] = [];
    for (const id of changed) {
      const source = byId.get(id);
      // A source the chapter cited that is GONE from the corpus (deleted, muted, excluded) has nothing to
      // quote — it still counts as drift, and the entry says so through its count rather than an item.
      if (source)
        items.push({
          sourceRef: source.ref,
          label: source.label,
          excerpt: excerpt(source.texts.join(' · ')),
        });
    }
    entries.push({
      chapterId: chapter.id,
      reason: 'newMaterial',
      items,
      detectedAt: now.toISOString(),
    });
  }

  if (entries.length > 0) await recordNewMaterial(fs, key, personId, bookId, entries);
  return entries.length;
}
