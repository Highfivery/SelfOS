import type { FileSystem } from '../host';
import {
  IntakeSessionSchema,
  type IntakeAnswerValue,
  type Question,
  type RelationshipType,
} from '../schemas';
import { readEncryptedJson } from '../vault';
// The catalog is pure data (it imports only `intimacy` + `schemas`), so importing it by its direct path —
// NOT the `../intake` barrel, which would pull `intakeService` and create a people↔intake cycle — is safe.
import { INTAKE_CATALOG } from '../intake/intakeCatalog';
// `effectiveAnswerScope` is pure (catalog + presets) and imported by its direct path for the same reason.
import { effectiveAnswerScope } from '../intake/sharingCategory';

/**
 * Read a person's SHARED structured intake answers into a related person's coaching context
 * (42-relationship-scoped-sharing §5.2). For each answered intake question whose `answerSharing[qid]`
 * (written by onboarding, spec 43) intersects the relationship type(s) describing how the OWNER relates to
 * the viewer (`grantedTypes`), emit a labelled `"<question prompt>: <answer>"` line. Capped per person so a
 * large intake never balloons the context. Restricted-section answers are governed by `answerSharing` too —
 * the per-question opt-in IS the deliberate act (§8); a question with no entry never shares.
 *
 * Lives in `people` (read by `buildContext`) and imports only the pure catalog, so it adds no cycle.
 */

/** A per-person cap, mirroring `MAX_SHARED_FACTS_PER_PERSON` — keeps the shared block bounded. */
const MAX_SHARED_ANSWERS_PER_PERSON = 8;

/** Question id → its catalog `Question` (for the prompt label + value formatting), across every section. */
const QUESTIONS_BY_ID: ReadonlyMap<string, Question> = new Map(
  INTAKE_CATALOG.flatMap((section) => (section.questions ?? []).map((fq) => [fq.q.id, fq.q])),
);

/** Look up a catalog intake question by id (its prompt is the human label), or undefined. */
export function getIntakeQuestion(questionId: string): Question | undefined {
  return QUESTIONS_BY_ID.get(questionId);
}

/** Stringify a stored intake answer value for context (compact; mirrors the synthesis formatter's intent). */
export function formatSharedAnswer(question: Question, value: IntakeAnswerValue): string {
  if (Array.isArray(value)) {
    // Object-row arrays (dateList {label,date} / roster {col→value}) → row values joined.
    if (value.some((it) => it !== null && typeof it === 'object')) {
      return value
        .map((row) =>
          Object.values(row as Record<string, string>)
            .map((v) => String(v).trim())
            .filter(Boolean)
            .join(', '),
        )
        .filter(Boolean)
        .join('; ');
    }
    return value
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value !== null && typeof value === 'object') {
    // A matrix (row → point) / allocation (bucket → amount). Map matrix points to their labels when the
    // question carries them, else "key: value" — never "[object Object]".
    const labels = matrixLabels(question);
    const min = question.matrix?.min ?? 0;
    return Object.entries(value as Record<string, number>)
      .map(([row, point]) => {
        const label =
          labels && typeof point === 'number'
            ? (labels[point - min] ?? String(point))
            : String(point);
        return `${row}: ${label}`;
      })
      .join('; ');
  }
  return String(value).trim();
}

/** A labelled matrix's point labels (N-point `pointLabels`, else the 3-label fallback), or null. */
function matrixLabels(question: Question): string[] | null {
  const m = question.matrix;
  if (!m) return null;
  const span = m.max - m.min + 1;
  if (m.pointLabels && m.pointLabels.length === span) return m.pointLabels;
  if (m.max - m.min === 2 && m.minLabel && m.midLabel && m.maxLabel)
    return [m.minLabel, m.midLabel, m.maxLabel];
  return null;
}

/** Whether a question's scope grants any of the relationship types the owner→viewer link resolves to. */
function answerGrants(
  scope: RelationshipType[] | undefined,
  grantedTypes: readonly RelationshipType[],
): boolean {
  return (scope ?? []).some((type) => grantedTypes.includes(type));
}

/**
 * The shared intake-answer context lines for a subject, given the relationship type(s) describing how the
 * subject relates to the viewer (already resolved by the caller via `relationshipTypesFromSubjectToViewer`).
 * Empty when the subject has no intake, no shared answers, or no granting types.
 */
export async function buildSharedIntakeAnswerLines(
  fs: FileSystem,
  key: Uint8Array,
  subjectId: string,
  grantedTypes: readonly RelationshipType[],
): Promise<string[]> {
  if (grantedTypes.length === 0) return [];
  const raw = await readEncryptedJson(fs, `people/${subjectId}/intake/session.enc`, key);
  if (raw === null) return [];
  const parsed = IntakeSessionSchema.safeParse(raw);
  // A corrupt intake fails closed — never silently broadcast (42 §7).
  if (!parsed.success) return [];

  const lines: string[] = [];
  for (const section of parsed.data.sections) {
    // Iterate ANSWERED questions (not just stored `answerSharing` entries): a portrait from before
    // per-question sharing has answers but no `answerSharing`, and `effectiveAnswerScope` backfills each
    // answered question's category default (restricted answers stay Private). An explicit choice wins.
    for (const questionId of Object.keys(section.answers)) {
      if (lines.length >= MAX_SHARED_ANSWERS_PER_PERSON) return lines;
      const scope = effectiveAnswerScope(section.id, questionId, section.answerSharing);
      if (!answerGrants(scope, grantedTypes)) continue;
      const value = section.answers[questionId];
      if (value === undefined) continue;
      const question = QUESTIONS_BY_ID.get(questionId);
      const text = question ? formatSharedAnswer(question, value) : '';
      if (text.trim() === '') continue;
      lines.push(`${question?.prompt ?? questionId}: ${text}`);
    }
  }
  return lines;
}
