import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { AssertMainOwnedHandled } from '../rebuildGuard';
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
  // Every main-owned field must be set fresh or carried forward below; see `rebuildGuard`. `favorite`
  // is the cautionary one: a list star, not author-supplied, so it is only here because someone
  // remembered to carry it — exactly the shape that lost `Dream.image`.
  const _guard: AssertMainOwnedHandled<
    Questionnaire,
    QuestionnaireInput,
    'schemaVersion' | 'version' | 'createdAt' | 'updatedAt' | 'creatorPersonId' | 'favorite'
  > = true;
  void _guard;
  const existing = input.id ? await getQuestionnaire(fs, key, input.id) : null;
  const at = new Date().toISOString();
  // Creator is stamped ONLY on actual create; an edit preserves the original (and never back-fills a
  // legacy creator-less def — editing it must not transfer authorship to the editor, which would let a
  // non-owner then delete it). A legacy def stays Owner-deletable-only (§3.9).
  const creator = existing ? existing.creatorPersonId : creatorPersonId;
  // Auto check-ins provenance (63 §4.2): set only on create by the auto engine; preserved across an edit
  // like `favorite`/`createdAt` (a manual edit must not strip the "auto-generated" tag off a def/snapshot).
  const autoCheckin = existing?.autoCheckin ?? input.autoCheckin;
  // Your Story interview provenance (64 §5.5) — the same host-side-only, preserved-across-edit rule.
  const storyProvenance = existing?.storyProvenance ?? input.storyProvenance;
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
    // The favorite flag lives on the def but isn't author-supplied (it's a list star), so carry it through
    // an edit from the existing def rather than dropping it (38 §13.8) — like createdAt/creatorPersonId.
    ...(existing?.favorite ? { favorite: existing.favorite } : {}),
    ...(autoCheckin !== undefined ? { autoCheckin } : {}),
    ...(storyProvenance !== undefined ? { storyProvenance } : {}),
  };
  await writeEncryptedJson(fs, defPath(questionnaire.id), questionnaire, key);
  return questionnaire;
}

/**
 * Toggle a questionnaire's favorite (pin) flag WITHOUT bumping its content `version` or `updatedAt` — it's
 * a list convenience, not an edit to the questions (38 §13.8). No-op if the questionnaire is gone.
 */
export async function setFavorite(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
  favorite: boolean,
): Promise<void> {
  const existing = await getQuestionnaire(fs, key, id);
  if (!existing) return;
  const next: Questionnaire = { ...existing, favorite };
  if (!favorite) delete next.favorite; // keep the absence-means-false invariant tidy
  await writeEncryptedJson(fs, defPath(id), next, key);
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
  if (input.questions.length === 0) problems.push('A questionnaire needs at least one question.');
  input.questions.forEach((q, index) => {
    if (NEEDS_OPTIONS.has(q.type) && (q.options?.length ?? 0) < 2) {
      problems.push(`"${q.prompt}" (${q.type}) needs at least two options.`);
    }
    if ((q.type === 'rating' || q.type === 'slider') && !q.scale) {
      problems.push(`"${q.prompt}" (${q.type}) needs a scale.`);
    }
    if (q.type === 'matrix' && (q.matrix?.rows.length ?? 0) === 0) {
      problems.push(`"${q.prompt}" (matrix) needs at least one row.`);
    }
    if (q.branch) {
      // A branch shows this question only once its trigger has been answered, so the trigger MUST be a
      // strictly-earlier question (38 §3.9). This single backward-only rule also makes a circular branch
      // impossible: each question has at most one branch pointing at one other, so a list whose every
      // branch points earlier is a backward forest — no cycle can form. A missing/self/later target is a
      // dead-end (the question could never appear).
      const targetIndex = input.questions.findIndex((o) => o.id === q.branch?.whenQuestionId);
      if (targetIndex === -1) {
        problems.push(
          `"${q.prompt}" branches on a missing question id (${q.branch.whenQuestionId}).`,
        );
      } else if (targetIndex === index) {
        problems.push(`"${q.prompt}" branches on itself, so it can never appear.`);
      } else if (targetIndex > index) {
        problems.push(
          `"${q.prompt}" branches on a later question, so it can never appear — move its trigger earlier.`,
        );
      }
    }
  });
  // The form must never be able to render empty: at least one question has to be unconditional (38 §3.9).
  if (input.questions.length > 0 && input.questions.every((q) => q.branch)) {
    problems.push(
      'Every question is conditional, so the form could show nothing — at least one question must always appear.',
    );
  }
  return problems;
}
