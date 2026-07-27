import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  COVERED_TOPICS_CAP,
  CoveredTopicsDocSchema,
  type CoveredTopic,
  type CoveredTopicsDoc,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Author-marked "already answered / covered" topics per recipient (08-questionnaires §28.3). When the author
 * marks a generated question repetitive, the topic is recorded here so ALL future generation for that
 * recipient avoids it — fed into `buildDedupReference` + the gap-finder's `avoidSuggestions`. One encrypted
 * doc per author at `people/<authorId>/questionnaires/coveredTopics.enc` (the `suggestions.enc` precedent).
 *
 * Per-active-person isolation is structural: the file lives under the AUTHOR's folder, so the active person
 * only ever reads/writes their own notes (the bridge scopes `authorId` to the active person).
 */

const SCHEMA_VERSION = 1;

const docPath = (authorId: string): string => `people/${authorId}/questionnaires/coveredTopics.enc`;

const emptyDoc = (): CoveredTopicsDoc => ({ schemaVersion: SCHEMA_VERSION, topics: [] });

async function readDoc(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
): Promise<CoveredTopicsDoc> {
  const raw = await readEncryptedJson(fs, docPath(authorId), key);
  if (!raw) return emptyDoc();
  // A corrupt/old doc degrades to empty rather than throwing out of a read generation depends on.
  const parsed = CoveredTopicsDocSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyDoc();
}

/** The author's covered-topic notes for one recipient (newest first), or `[]` if none. No AI spend. */
export async function listCoveredTopics(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  recipientPersonId: string,
): Promise<CoveredTopic[]> {
  const doc = await readDoc(fs, key, authorId);
  return doc.topics
    .filter((t) => t.recipientPersonId === recipientPersonId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Record a covered topic for a recipient and persist. De-dupes by normalized note (marking the same topic
 * twice keeps one, refreshed). Caps the recipient's set at `COVERED_TOPICS_CAP` (oldest dropped). Returns the
 * recipient's set (newest first). `now`/`mintId` are injected for deterministic tests.
 */
export async function markCoveredTopic(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  input: { recipientPersonId: string; note: string; sourcePrompt?: string },
  now: Date,
  mintId: () => string = uuid,
): Promise<CoveredTopic[]> {
  const note = input.note.trim();
  const doc = await readDoc(fs, key, authorId);
  const norm = (s: string): string => s.trim().toLowerCase();
  // Drop an existing note for the same recipient with the same gist, so it's refreshed to the top.
  const kept = doc.topics.filter(
    (t) => !(t.recipientPersonId === input.recipientPersonId && norm(t.note) === norm(note)),
  );
  const entry: CoveredTopic = {
    id: mintId(),
    recipientPersonId: input.recipientPersonId,
    note,
    ...(input.sourcePrompt?.trim() ? { sourcePrompt: input.sourcePrompt.trim() } : {}),
    createdAt: now.toISOString(),
  };
  // Prepend, then re-cap this recipient's slice (keep newest COVERED_TOPICS_CAP) while leaving others intact.
  const forRecipient = [
    entry,
    ...kept.filter((t) => t.recipientPersonId === input.recipientPersonId),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, COVERED_TOPICS_CAP);
  const others = kept.filter((t) => t.recipientPersonId !== input.recipientPersonId);
  await writeEncryptedJson(
    fs,
    docPath(authorId),
    { schemaVersion: SCHEMA_VERSION, topics: [...others, ...forRecipient] },
    key,
  );
  return forRecipient;
}
