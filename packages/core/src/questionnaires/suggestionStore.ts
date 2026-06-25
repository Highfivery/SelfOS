import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  QuestionnaireSuggestionsDocSchema,
  SUGGESTION_CAP,
  type QuestionnaireSuggestion,
  type QuestionnaireSuggestionsDoc,
  type SavedSuggestion,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Persisted gap-finder suggestions (08-questionnaires §18.3). The author's saved questionnaire ideas, kept per
 * recipient so re-opening the "Suggested" surface needs no AI spend. One encrypted doc per author at
 * `people/<authorId>/questionnaires/suggestions.enc` (the `guidanceService` cache precedent), holding one set
 * per recipient. "Suggest more" ACCUMULATES (capped at `SUGGESTION_CAP`, newest kept); a suggestion is removed
 * manually (the card's Delete) or automatically once a questionnaire is created from it (§18.4).
 *
 * Per-active-person isolation is structural: the file lives under the AUTHOR's folder, so the active person
 * only ever reads/writes their own ideas (the bridge scopes `authorId` to the active person).
 */

const SCHEMA_VERSION = 1;

const docPath = (authorId: string): string => `people/${authorId}/questionnaires/suggestions.enc`;

const emptyDoc = (): QuestionnaireSuggestionsDoc => ({ schemaVersion: SCHEMA_VERSION, sets: [] });

async function readDoc(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
): Promise<QuestionnaireSuggestionsDoc> {
  const raw = await readEncryptedJson(fs, docPath(authorId), key);
  if (!raw) return emptyDoc();
  // A corrupt/old doc degrades to empty rather than throwing out of a read the panel depends on.
  const parsed = QuestionnaireSuggestionsDocSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyDoc();
}

async function writeDoc(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  doc: QuestionnaireSuggestionsDoc,
): Promise<void> {
  await writeEncryptedJson(fs, docPath(authorId), doc, key);
}

/** The author's saved suggestions for one recipient (newest first), or `[]` if none. No AI spend. */
export async function listSavedSuggestions(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  recipientPersonId: string,
): Promise<SavedSuggestion[]> {
  const doc = await readDoc(fs, key, authorId);
  return doc.sets.find((s) => s.recipientPersonId === recipientPersonId)?.suggestions ?? [];
}

/**
 * Append a freshly-generated batch for a recipient and persist. Each new proposal gets a stable `id` +
 * `createdAt`; the batch is PREPENDED (newest first) and the set is capped to `SUGGESTION_CAP` (oldest
 * dropped). Returns the updated set. `now`/`mintId` are injected for deterministic tests.
 */
export async function accumulateSavedSuggestions(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  recipientPersonId: string,
  batch: QuestionnaireSuggestion[],
  now: Date,
  mintId: () => string = uuid,
): Promise<SavedSuggestion[]> {
  const doc = await readDoc(fs, key, authorId);
  const existing = doc.sets.find((s) => s.recipientPersonId === recipientPersonId);
  const minted: SavedSuggestion[] = batch.map((s) => ({
    ...s,
    id: mintId(),
    createdAt: now.toISOString(),
  }));
  const merged = [...minted, ...(existing?.suggestions ?? [])].slice(0, SUGGESTION_CAP);
  const others = doc.sets.filter((s) => s.recipientPersonId !== recipientPersonId);
  await writeDoc(fs, key, authorId, {
    schemaVersion: SCHEMA_VERSION,
    sets: [...others, { recipientPersonId, suggestions: merged, updatedAt: now.toISOString() }],
  });
  return merged;
}

/**
 * Remove one saved suggestion (the card Delete, or the auto-remove once a questionnaire is created from it,
 * §18.4). Returns the recipient's remaining set; a no-op if it wasn't there.
 */
export async function deleteSavedSuggestion(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  recipientPersonId: string,
  suggestionId: string,
  now: Date,
): Promise<SavedSuggestion[]> {
  const doc = await readDoc(fs, key, authorId);
  const set = doc.sets.find((s) => s.recipientPersonId === recipientPersonId);
  if (!set) return [];
  const remaining = set.suggestions.filter((s) => s.id !== suggestionId);
  const others = doc.sets.filter((s) => s.recipientPersonId !== recipientPersonId);
  await writeDoc(fs, key, authorId, {
    schemaVersion: SCHEMA_VERSION,
    sets: [...others, { recipientPersonId, suggestions: remaining, updatedAt: now.toISOString() }],
  });
  return remaining;
}
