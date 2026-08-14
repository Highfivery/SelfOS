import type { FileSystem } from '../host';
import type {
  BookConsentEntry,
  CastMember,
  ConsentPerson,
  PublishedManifest,
  ReaderChapter,
} from '../schemas';
import { getCastRegister } from './castRegister';
import { getConsent, saveConsent } from './storyService';
import { applyPseudonyms } from './storyText';

/**
 * People in your book (72 §3.9/§4.7; was 64 §17.5's consent center).
 *
 * A book names real living people. This gives the author a per-book register of everyone the book names (from
 * the same source as the cast register — the People graph + memories + named mentions) and, per person, the
 * two things that actually change something:
 *
 * - a **pseudonym**, applied everywhere the book is READ or EXPORTED (the owner's immersive reader, a shared
 *   reader, every export) while the draft keeps the real name;
 * - a **character sheet** (§4.8), the author's description of how someone looks, injected into image prompts
 *   for a book type whose framing permits likeness — a picture book's hero. Inert for every other type.
 *
 * The four manual consent states are gone (72 §5.9): nothing was ever sent to anyone and nothing was ever
 * blocked, so they were an author's private note the app made them maintain, and the publish-time warning
 * they drove is gone with them.
 */

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The People-tab read: every person the book names, joined with what the author calls them and how they look.
 * A stored entry for someone the cast no longer surfaces is kept (they may reappear). Ordered by cast
 * prominence, then any leftover stored-only names.
 */
export async function getConsentRegister(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<ConsentPerson[]> {
  const cast = await getCastRegister(fs, key, personId, bookId).catch(() => []);
  const stored = await getConsent(fs, key, personId, bookId).catch(() => ({
    schemaVersion: 1 as const,
    entries: [] as BookConsentEntry[],
  }));
  const byName = new Map(stored.entries.map((e) => [normalize(e.name), e]));

  const out: ConsentPerson[] = [];
  const seen = new Set<string>();
  for (const c of cast) {
    const k = normalize(c.name);
    seen.add(k);
    const decision = byName.get(k);
    out.push({
      name: c.name,
      ...(c.personId ? { personId: c.personId } : {}),
      ...(c.relationship ? { relationship: c.relationship } : {}),
      mentions: c.mentions,
      chapterMentions: c.chapterMentions,
      ...(decision?.pseudonym ? { pseudonym: decision.pseudonym } : {}),
      ...(decision?.sheet ? { sheet: decision.sheet } : {}),
    });
  }
  // A stored decision for someone the cast no longer surfaces — keep it visible (they were named before).
  for (const e of stored.entries) {
    if (seen.has(normalize(e.name))) continue;
    out.push({
      name: e.name,
      ...(e.personId ? { personId: e.personId } : {}),
      mentions: 0,
      chapterMentions: 0,
      ...(e.pseudonym ? { pseudonym: e.pseudonym } : {}),
      ...(e.sheet ? { sheet: e.sheet } : {}),
    });
  }
  return out;
}

/**
 * Set what a person is called in the book and/or how they look. Each field is INDEPENDENT: an absent field
 * leaves the stored value alone, an empty string clears it. That distinction is the whole point — the two
 * fields have separate editors, so a whole-entry replace would silently wipe a character sheet the moment the
 * author set a pseudonym (the merge-by-id lesson from Memory's per-fact edit). Returns the fresh register.
 */
export async function setConsentEntry(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  args: { bookId: string; name: string; pseudonym?: string; sheet?: string; now: Date },
): Promise<ConsentPerson[]> {
  const list = await getConsent(fs, key, personId, args.bookId);
  const k = normalize(args.name);
  const existing = list.entries.find((e) => normalize(e.name) === k);
  /** Absent ⇒ keep what's stored; present ⇒ take it (blank clears). */
  const merge = (next: string | undefined, prev: string | undefined): string | undefined =>
    next === undefined ? prev : next.trim() || undefined;
  const pseudonym = merge(args.pseudonym, existing?.pseudonym);
  const sheet = merge(args.sheet, existing?.sheet);
  const entry: BookConsentEntry = {
    name: args.name.trim(),
    ...(pseudonym ? { pseudonym } : {}),
    ...(sheet ? { sheet } : {}),
    updatedAt: args.now.toISOString(),
  };
  const next = existing
    ? list.entries.map((e) =>
        normalize(e.name) === k ? { ...entry, ...(e.personId ? { personId: e.personId } : {}) } : e,
      )
    : [...list.entries, entry];
  await saveConsent(fs, key, personId, args.bookId, { schemaVersion: 1, entries: next });
  return getConsentRegister(fs, key, personId, args.bookId);
}

/** The pseudonym substitution map (realName → pseudonym) from the stored consent entries — the only thing the
 *  read/export paths need. Empty when no pseudonyms are set. */
export async function pseudonymMap(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<Record<string, string>> {
  const list = await getConsent(fs, key, personId, bookId).catch(() => ({
    schemaVersion: 1 as const,
    entries: [] as BookConsentEntry[],
  }));
  const map: Record<string, string> = {};
  for (const e of list.entries) {
    if (e.pseudonym?.trim()) map[e.name] = e.pseudonym.trim();
  }
  return map;
}

/** Apply the pseudonym map to a set of reader chapters — pure, map-empty is a no-op. Covers EVERY name-bearing
 *  field a reader sees: the chapter TITLE + prose + pinned quotes + each image placement's caption. A chapter
 *  title and an AI-written caption are auto-generated, so the author never got to self-substitute — they must be
 *  covered or a real name leaks past the pseudonym (§17.5). */
export function pseudonymizeChapters(
  chapters: ReaderChapter[],
  map: Record<string, string>,
): ReaderChapter[] {
  if (Object.keys(map).length === 0) return chapters;
  return chapters.map((c) => ({
    ...c,
    title: applyPseudonyms(c.title, map),
    markdown: applyPseudonyms(c.markdown, map),
    imagePlacements: c.imagePlacements.map((pl) => ({
      ...pl,
      caption: applyPseudonyms(pl.caption, map),
    })),
    ...(c.pinnedQuotes
      ? { pinnedQuotes: c.pinnedQuotes.map((q) => ({ ...q, text: applyPseudonyms(q.text, map) })) }
      : {}),
  }));
}

/** Apply the pseudonym map to the published cast list, so the dramatis personae shows the pseudonym too. */
export function pseudonymizeCast(cast: CastMember[], map: Record<string, string>): CastMember[] {
  if (Object.keys(map).length === 0) return cast;
  return cast.map((m) => ({ ...m, name: applyPseudonyms(m.name, map) }));
}

/**
 * Apply the pseudonym map to a published/reader manifest — the ONE comprehensive substitution for every
 * name-bearing field OUTSIDE the chapter bodies: the title, the AI-written essence, the front/back matter
 * (dedication / epigraph / acknowledgments / about-the-author / colophon), the dramatis personae cast, and each
 * image's caption + vision notes. Pure; map-empty is a no-op. Pairing this with `pseudonymizeChapters` covers
 * every surface a reader (owner or shared) or an export can render (§17.5).
 */
export function pseudonymizeManifest(
  manifest: PublishedManifest,
  map: Record<string, string>,
): PublishedManifest {
  if (Object.keys(map).length === 0) return manifest;
  const sub = (s: string): string => applyPseudonyms(s, map);
  const m = manifest.matter;
  const matter = m
    ? {
        ...m,
        ...(m.dedication ? { dedication: sub(m.dedication) } : {}),
        ...(m.epigraph ? { epigraph: sub(m.epigraph) } : {}),
        ...(m.acknowledgments ? { acknowledgments: sub(m.acknowledgments) } : {}),
        ...(m.aboutAuthor ? { aboutAuthor: sub(m.aboutAuthor) } : {}),
        ...(m.colophon ? { colophon: sub(m.colophon) } : {}),
      }
    : undefined;
  return {
    ...manifest,
    title: sub(manifest.title),
    ...(manifest.essence ? { essence: sub(manifest.essence) } : {}),
    ...(matter ? { matter } : {}),
    ...(manifest.cast ? { cast: pseudonymizeCast(manifest.cast, map) } : {}),
    images: manifest.images.map((img) => ({
      ...img,
      ...(img.caption ? { caption: sub(img.caption) } : {}),
      ...(img.visionNotes ? { visionNotes: sub(img.visionNotes) } : {}),
    })),
  };
}

/**
 * The character-sheet map (realName → sheet) for a book, for the image path (§4.8/§8.5).
 *
 * The CALLER decides whether to use it: it is only ever read for a book type whose `imageFraming` permits
 * likeness, so a sheet stored against any other type never reaches an image provider. Empty when none are set.
 */
export async function characterSheets(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<Record<string, string>> {
  const list = await getConsent(fs, key, personId, bookId).catch(() => ({
    schemaVersion: 1 as const,
    entries: [] as BookConsentEntry[],
  }));
  const map: Record<string, string> = {};
  for (const e of list.entries) {
    if (e.sheet?.trim()) map[e.name] = e.sheet.trim();
  }
  return map;
}
