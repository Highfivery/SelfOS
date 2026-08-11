import { QuestionSchema, type BranchRule, type Question } from '../schemas';
import { questionShapeProblems } from './questionnaireService';

/**
 * Applying a corrected question (08 §32).
 *
 * When a recipient says a question is wrong — a detail about them is untrue, or the answers don't fit — the
 * question is REWRITTEN FOR REAL: prompt, help, answer type, options and how many there are, scale anchors,
 * matrix rows. The corrected question replaces the original in the send being answered (and, when the
 * corrector is also its author, in the questionnaire itself), and the answer is stored against the CORRECTED
 * question.
 *
 * This deliberately replaced an earlier display-only model that kept the sender's wording and mapped the
 * answer back to an original option string. That recorded an answer the person never picked, and left the bad
 * question in place to be asked again — see the §32.7 rewrite.
 *
 * Only the question's IDENTITY is preserved, because other records point at it:
 * - `id` — answers, branch rules and the response set are keyed by it;
 * - `canonicalId` — pairs the two halves of a compatibility send (§3.6);
 * - `metricKey` — the trend series a rating feeds (§3.7).
 */
const PRESERVED_KEYS = ['id', 'canonicalId', 'metricKey'] as const;

/**
 * Validate a model-proposed replacement against the question it replaces.
 *
 * Returns the corrected question, or `null` when the proposal isn't a usable question at all — a malformed
 * reply must never overwrite a working one. `QuestionSchema` is the real guard: it rejects a choice type with
 * no options, a matrix with no rows, a bad scale, and so on, so a structurally invalid rewrite can't persist.
 */
export function sanitizeCorrectedQuestion(
  original: Question,
  proposed: Partial<Question> | undefined,
): Question | null {
  if (!proposed || typeof proposed !== 'object') return null;
  const merged: Record<string, unknown> = { ...original, ...proposed };
  for (const k of PRESERVED_KEYS) {
    if (original[k] === undefined) delete merged[k];
    else merged[k] = original[k];
  }
  // A rewrite that changes the answer TYPE must bring the shape that type needs, and drop what it doesn't —
  // otherwise a leftover `options` on a now-shortText question, or a missing `options` on a now-choice one,
  // would persist as a broken question.
  const type = merged['type'];
  if (type !== original.type) {
    if (proposed.options === undefined) delete merged['options'];
    if (proposed.scale === undefined) delete merged['scale'];
    if (proposed.matrix === undefined) delete merged['matrix'];
    if (proposed.roster === undefined) delete merged['roster'];
  }
  const parsed = QuestionSchema.safeParse(merged);
  if (!parsed.success) return null;
  const q = parsed.data;
  // The schema alone is too permissive to answer with — it allows e.g. `options: []` on a choice question.
  // Reuse the questionnaire validator's own per-question rules so a correction can only ever produce a
  // question the app would have accepted from an author.
  if (questionShapeProblems(q).length > 0) return null;
  // Options must be distinct: an option string IS the stored answer, so two identical options make the
  // recorded choice ambiguous. Dropping a wrong detail is exactly what collapses two options into one phrase.
  if (q.options && new Set(q.options).size !== q.options.length) return null;
  return q;
}

/** Whether a corrected question actually changed anything the recipient can see. */
export function correctionChanged(before: Question, after: Question): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Whether a branch rule's trigger value survived the correction of the question it points at. */
function ruleStillResolves(rule: BranchRule, corrected: Question): boolean {
  const values = corrected.options ?? [];
  const present = (v: string | number | boolean): boolean =>
    typeof v === 'boolean' ? corrected.type === 'yesNo' : values.includes(String(v));
  if (rule.equalsAny) return rule.equalsAny.some(present);
  if (rule.equals !== undefined) return present(rule.equals);
  return true;
}

/**
 * Repair the questionnaire's branch rules after `corrected` replaced one of its questions.
 *
 * A rule names its trigger by OPTION STRING, so replacing an option set can strand a follow-up question:
 * its condition can never be met again and it silently disappears from the form. A stranded rule is
 * DROPPED (the follow-up becomes unconditional) rather than left dangling — a question the person can see
 * and skip beats one that vanishes with no trace. `equalsAny` keeps whichever values still resolve.
 */
export function repairBranchRules(questions: Question[], corrected: Question): Question[] {
  return questions.map((q) => {
    if (!q.branch || q.branch.whenQuestionId !== corrected.id) return q;
    if (ruleStillResolves(q.branch, corrected)) {
      if (!q.branch.equalsAny) return q;
      const kept = q.branch.equalsAny.filter(
        (v) => corrected.options?.includes(String(v)) ?? typeof v === 'boolean',
      );
      return kept.length === q.branch.equalsAny.length
        ? q
        : { ...q, branch: { ...q.branch, equalsAny: kept } };
    }
    const rest = { ...q };
    delete rest.branch;
    return rest;
  });
}

/** Replace one question in a list by id, repairing any branch rules that pointed at it. */
export function replaceQuestion(questions: Question[], corrected: Question): Question[] {
  return repairBranchRules(
    questions.map((q) => (q.id === corrected.id ? corrected : q)),
    corrected,
  );
}
