import type { FileSystem } from '../host';
import { DreamAnalysisSchema, DreamSchema, type Dream, type DreamAnalysis } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Dreams data layer (12-dreams §4.1/§5.1). Encrypted CRUD over a person's dreams and their analyses,
 * stored in a per-dream folder so each dream owns its narrative, its synthesized analysis, and (added by
 * the guided-analysis slice) its transcript:
 *
 *   people/<personId>/dreams/<dreamId>/dream.enc        — the Dream (capture)
 *   people/<personId>/dreams/<dreamId>/analysis.enc     — the DreamAnalysis (once synthesized)
 *   people/<personId>/dreams/<dreamId>/conversation.enc — the guided-analysis transcript (slice 3)
 *   people/<personId>/dreams/patterns.enc               — the cached pattern narrative (slice 4)
 *
 * The transcript lives under the dream — NOT in people/<id>/conversations/ — so the Sessions surface
 * (05), which lists only that folder, never shows it (12 §3.2). Dreams are private to the dreamer (12 §8.4).
 */

function dreamsDir(personId: string): string {
  return `people/${personId}/dreams`;
}

function dreamDir(personId: string, dreamId: string): string {
  return `${dreamsDir(personId)}/${dreamId}`;
}

function dreamPath(personId: string, dreamId: string): string {
  return `${dreamDir(personId, dreamId)}/dream.enc`;
}

function analysisPath(personId: string, dreamId: string): string {
  return `${dreamDir(personId, dreamId)}/analysis.enc`;
}

/** Write (or overwrite) a dream under its dreamer's encrypted folder. */
export async function saveDream(fs: FileSystem, key: Uint8Array, dream: Dream): Promise<void> {
  await writeEncryptedJson(fs, dreamPath(dream.personId, dream.id), dream, key);
}

/** Read one dream by dreamer + id; null if absent. */
export async function getDream(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  dreamId: string,
): Promise<Dream | null> {
  const raw = await readEncryptedJson(fs, dreamPath(personId, dreamId), key);
  return raw ? DreamSchema.parse(raw) : null;
}

/** List a dreamer's dreams, newest first (by `createdAt`). */
export async function listDreams(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Dream[]> {
  const out: Dream[] = [];
  for (const name of await fs.list(dreamsDir(personId))) {
    // Dream folders are id-named (no extension); skip files that live directly in the dreams dir, e.g.
    // patterns.enc (slice 4). The host treats a stray non-dir entry's `.../dream.enc` read as absent.
    if (name.endsWith('.enc')) continue;
    // A folder with no dream.enc (e.g. an orphaned analysis.enc from a partial sync) is intentionally not
    // surfaced — the journal reflects capturable dreams, not every on-disk folder. deleteDream still purges
    // the whole folder. (Richer corrupt/missing-file handling lands with the later slices, 12 §7.)
    const raw = await readEncryptedJson(fs, dreamPath(personId, name), key);
    if (!raw) continue;
    const dream = DreamSchema.parse(raw);
    // Defense in depth: only serve dreams whose dreamer matches the folder, so a misplaced or tampered
    // file can't leak into another person's journal (12 §8.4).
    if (dream.personId === personId) out.push(dream);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

/**
 * Delete a dream — purges its whole folder (dream + analysis + transcript). No key needed; removal doesn't
 * read ciphertext. Removing the linked Insight (if the analysis was approved into context) is orchestrated
 * by the approve / remove-from-context flow (12 §3.3/§3.6), which lands with the analysis slice.
 */
export async function deleteDream(
  fs: FileSystem,
  personId: string,
  dreamId: string,
): Promise<void> {
  await fs.remove(dreamDir(personId, dreamId));
}

/** Write (or overwrite) a dream's synthesized analysis. */
export async function saveAnalysis(
  fs: FileSystem,
  key: Uint8Array,
  analysis: DreamAnalysis,
): Promise<void> {
  await writeEncryptedJson(fs, analysisPath(analysis.personId, analysis.dreamId), analysis, key);
}

/** Read a dream's analysis by dreamer + dream id; null if not yet analyzed. */
export async function getAnalysis(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  dreamId: string,
): Promise<DreamAnalysis | null> {
  const raw = await readEncryptedJson(fs, analysisPath(personId, dreamId), key);
  return raw ? DreamAnalysisSchema.parse(raw) : null;
}
