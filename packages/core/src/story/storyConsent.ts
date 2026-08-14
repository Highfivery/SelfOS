import type { FileSystem } from '../host';
import type {
  BookConsentEntry,
  CastMember,
  ConsentPerson,
  ConsentState,
  PublishedManifest,
  ReaderChapter,
} from '../schemas';
import { getCastRegister } from './castRegister';
import { getConsent, saveConsent } from './storyService';
import { applyPseudonyms } from './storyText';

/**
 * People-in-your-book consent center + pseudonyms (64-your-story §17.5, #290).
 *
 * A biography names real living people. This gives the author a per-book register of everyone the book names
 * (from the same source as the cast register — the People graph + memories + named mentions) with a MANUAL
 * consent state (unknown / requested / granted / declined; SelfOS never contacts anyone) and an optional
 * pseudonym. The pseudonym map is applied everywhere the book is READ or EXPORTED — the owner's own immersive
 * reader, a shared reader, and every export — while the draft keeps the real name. A declined/un-consented
 * name only WARNS at publish (a pseudonym is the fix); it is never a hard block.
 */

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The consent center read: every person the book names, joined with the author's decision. New people (in the
 * cast, not yet in the store) default to `unknown`; a stored decision for someone no longer named is kept
 * (they may reappear). Ordered by cast prominence, then any leftover stored-only names.
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
      consent: decision?.consent ?? 'unknown',
      ...(decision?.pseudonym ? { pseudonym: decision.pseudonym } : {}),
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
      consent: e.consent,
      ...(e.pseudonym ? { pseudonym: e.pseudonym } : {}),
    });
  }
  return out;
}

/** Set (or update) a person's consent + pseudonym. An empty pseudonym clears it. Returns the fresh register. */
export async function setConsentEntry(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  args: { bookId: string; name: string; consent: ConsentState; pseudonym?: string; now: Date },
): Promise<ConsentPerson[]> {
  const list = await getConsent(fs, key, personId, args.bookId);
  const k = normalize(args.name);
  const pseudonym = args.pseudonym?.trim();
  const entry: BookConsentEntry = {
    name: args.name.trim(),
    consent: args.consent,
    ...(pseudonym ? { pseudonym } : {}),
    updatedAt: args.now.toISOString(),
  };
  const existing = list.entries.find((e) => normalize(e.name) === k);
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

/** The named people who would appear under their REAL name at publish — i.e. not granted and with no pseudonym.
 *  Drives the warn-not-block notice (§17.5). */
export function unconsentedNames(register: ConsentPerson[]): string[] {
  return register.filter((p) => p.consent !== 'granted' && !p.pseudonym?.trim()).map((p) => p.name);
}
