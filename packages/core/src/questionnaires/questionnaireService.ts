import type { FileSystem } from '../host';
import { uuid } from '../id';
import { QuestionnaireSchema, type Questionnaire, type QuestionnaireInput } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { DEFS_DIR, defPath } from './paths';

/**
 * CRUD over questionnaire definitions (08-questionnaires §4.2). Questionnaires are created fresh (no
 * templates) and persist so they can be re-sent. Editing **bumps `version`** (the immutable-snapshot
 * version); sends snapshot the definition at send time (assignmentService), so a later edit never
 * alters an in-flight assignment.
 */

/** Read one questionnaire definition; null if absent. */
export async function getQuestionnaire(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<Questionnaire | null> {
  const raw = await readEncryptedJson(fs, defPath(id), key);
  return raw ? QuestionnaireSchema.parse(raw) : null;
}

/** List questionnaire definitions, newest first (by `updatedAt`). */
export async function listQuestionnaires(
  fs: FileSystem,
  key: Uint8Array,
): Promise<Questionnaire[]> {
  const out: Questionnaire[] = [];
  for (const name of await fs.list(DEFS_DIR)) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${DEFS_DIR}/${name}`, key);
    if (raw) out.push(QuestionnaireSchema.parse(raw));
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/**
 * Create or update a definition. Updating bumps `version` and preserves `createdAt`. Drafts may be
 * incomplete — validity is enforced at **send** (see `validateQuestionnaire` / `createAssignment`),
 * not here, so a half-built questionnaire can be saved.
 */
export async function saveQuestionnaire(
  fs: FileSystem,
  key: Uint8Array,
  input: QuestionnaireInput,
  creatorPersonId?: string,
): Promise<Questionnaire> {
  const existing = input.id ? await getQuestionnaire(fs, key, input.id) : null;
  const at = new Date().toISOString();
  // Creator is stamped ONLY on actual create; an edit preserves the original (and never back-fills a
  // legacy creator-less def — editing it must not transfer authorship to the editor, which would let a
  // non-owner then delete it). A legacy def stays Owner-deletable-only (§3.9).
  const creator = existing ? existing.creatorPersonId : creatorPersonId;
  const questionnaire: Questionnaire = {
    id: existing?.id ?? input.id ?? uuid(),
    schemaVersion: 1,
    version: existing ? existing.version + 1 : 1,
    title: input.title,
    type: input.type,
    sensitivity: input.sensitivity,
    questions: input.questions,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(creator !== undefined ? { creatorPersonId: creator } : {}),
    ...(input.recipient !== undefined ? { recipient: input.recipient } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.compatibility !== undefined ? { compatibility: input.compatibility } : {}),
  };
  await writeEncryptedJson(fs, defPath(questionnaire.id), questionnaire, key);
  return questionnaire;
}

/** Delete a questionnaire definition (no key needed — removal doesn't read ciphertext). */
export async function deleteQuestionnaire(fs: FileSystem, id: string): Promise<void> {
  await fs.remove(defPath(id));
}

const NEEDS_OPTIONS: ReadonlySet<string> = new Set([
  'singleChoice',
  'multiChoice',
  'ranking',
  'thisOrThat',
  // allocation also needs its buckets to sum to 100 — that contract is enforced at ANSWER time (slice 5),
  // not at definition time; here we just require the buckets to exist.
  'allocation',
]);

/**
 * Structural validation beyond the Zod shape: per-answer-type required fields + branch targets exist.
 * Returns human-readable problems (empty array = valid). Enforced before a send; the builder can also
 * surface it live. Drafts are allowed to be invalid (not enforced by `saveQuestionnaire`).
 */
export function validateQuestionnaire(input: Questionnaire | QuestionnaireInput): string[] {
  const problems: string[] = [];
  const ids = new Set(input.questions.map((q) => q.id));
  if (input.questions.length === 0) problems.push('A questionnaire needs at least one question.');
  for (const q of input.questions) {
    if (NEEDS_OPTIONS.has(q.type) && (q.options?.length ?? 0) < 2) {
      problems.push(`"${q.prompt}" (${q.type}) needs at least two options.`);
    }
    if ((q.type === 'rating' || q.type === 'slider') && !q.scale) {
      problems.push(`"${q.prompt}" (${q.type}) needs a scale.`);
    }
    if (q.type === 'matrix' && (q.matrix?.rows.length ?? 0) === 0) {
      problems.push(`"${q.prompt}" (matrix) needs at least one row.`);
    }
    if (q.branch && !ids.has(q.branch.whenQuestionId)) {
      problems.push(
        `"${q.prompt}" branches on a missing question id (${q.branch.whenQuestionId}).`,
      );
    }
  }
  return problems;
}
