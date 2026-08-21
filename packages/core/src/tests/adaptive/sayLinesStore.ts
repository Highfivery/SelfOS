import type { FileSystem } from '../../host';
import { isSafePairKey, isSafeSegment } from '../../pathSafety';
import { SayLinesStoreSchema, type SayLinesStore, type StarredLine } from '../../schemas';
import { uuid } from '../../id';
import { readEncryptedJson, writeEncryptedJson } from '../../vault';

/**
 * 75 §4 — the lines the person chose to KEEP, and the brief they last asked for.
 *
 * Stored in the REQUESTER's own space, keyed by pair. Nothing about the partner is written here beyond the
 * prose the requester starred — the generator reads their partner's lexicon and never writes to it.
 *
 * **Kept lines outlive the partner's data** (owner decision, 75 §11.1-9): if the partner clears their lexicon
 * or leaves the household, `partnerLandingSignal` returns null and nothing NEW can be generated — but what was
 * already starred stays. That is a deliberate exception to 74 §3.6.11's "delete is delete", recorded in
 * 75 §8.3 rather than left to be discovered as a missed reap.
 */

const SCHEMA_VERSION = 1;
/** Enough to be a keepsake, bounded so the file cannot grow without limit. */
export const MAX_KEPT_LINES = 100;

export function sayLinesPath(personId: string, pairKey: string): string {
  return `people/${personId}/together/sayLines/${pairKey}.enc`;
}

function empty(pairKey: string): SayLinesStore {
  return { schemaVersion: SCHEMA_VERSION, pairKey, lines: [] };
}

/** A corrupt or absent file degrades to empty rather than throwing out of the surface that reads it. */
export async function readSayLines(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  pairKey: string,
): Promise<SayLinesStore> {
  if (!isSafeSegment(personId) || !isSafePairKey(pairKey)) return empty(pairKey);
  try {
    const raw = await readEncryptedJson(fs, sayLinesPath(personId, pairKey), key);
    if (!raw) return empty(pairKey);
    const parsed = SayLinesStoreSchema.safeParse(raw);
    return parsed.success ? parsed.data : empty(pairKey);
  } catch {
    return empty(pairKey);
  }
}

async function write(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  store: SayLinesStore,
): Promise<SayLinesStore> {
  if (!isSafeSegment(personId) || !isSafePairKey(store.pairKey)) return store;
  await writeEncryptedJson(fs, sayLinesPath(personId, store.pairKey), store, key);
  return store;
}

/** Keep a line. Idempotent on the exact text, so double-tapping the star cannot produce two rows. */
export async function starLine(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  pairKey: string,
  text: string,
  brief: string | undefined,
  now: Date,
): Promise<SayLinesStore> {
  const trimmed = text.trim();
  if (trimmed === '') return readSayLines(fs, key, personId, pairKey);
  const store = await readSayLines(fs, key, personId, pairKey);
  if (store.lines.some((l) => l.text.trim().toLowerCase() === trimmed.toLowerCase())) return store;
  const line: StarredLine = {
    id: uuid(),
    text: trimmed,
    createdAt: now.toISOString(),
    ...(brief && brief.trim() !== '' ? { brief: brief.trim() } : {}),
  };
  // Newest first, and bounded — the cap drops the OLDEST, never the one just kept.
  return write(fs, key, personId, {
    ...store,
    lines: [line, ...store.lines].slice(0, MAX_KEPT_LINES),
  });
}

export async function unstarLine(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  pairKey: string,
  id: string,
): Promise<SayLinesStore> {
  const store = await readSayLines(fs, key, personId, pairKey);
  const lines = store.lines.filter((l) => l.id !== id);
  if (lines.length === store.lines.length) return store;
  return write(fs, key, personId, { ...store, lines });
}

/**
 * 75 §11.1-10 — remember what they last asked for, so the box comes back filled.
 *
 * Written on generate rather than on every keystroke: it records what was actually asked, not what was typed
 * and abandoned.
 */
export async function rememberBrief(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  pairKey: string,
  brief: string,
): Promise<void> {
  const store = await readSayLines(fs, key, personId, pairKey);
  const next = brief.trim();
  if ((store.lastBrief ?? '') === next) return;
  await write(fs, key, personId, {
    ...store,
    ...(next === '' ? { lastBrief: undefined } : { lastBrief: next }),
  });
}
