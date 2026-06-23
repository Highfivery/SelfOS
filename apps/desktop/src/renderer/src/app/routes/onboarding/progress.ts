import { visibleQuestions } from '@selfos/core/questionnaires';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import type { IntakeSectionMeta } from '@shared/channels';

/**
 * Onboarding progress maths (18-personal-onboarding §3.1). Pure + tested so the progress bar + per-card
 * counts can't silently drift. Progress is measured by SECTION overall (a section counts once it's finished),
 * with each form section reporting its own answered / visible-question count.
 */

export type IntakeSectionStatus = 'notStarted' | 'inProgress' | 'skipped' | 'complete';

/** Whether an answer value counts as filled in (empty string / empty list / empty object do not). */
export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0; // matrix / allocation maps
  return true; // a number (rating/slider) or boolean (yes/no) is an answer
}

/** Answered vs total for ONE form section, branch-aware (only currently-visible questions count). */
export function sectionProgress(
  meta: IntakeSectionMeta,
  answers: AnswerMap,
): { answered: number; total: number } {
  const questions = meta.questions ?? [];
  if (questions.length === 0) return { answered: 0, total: 0 };
  const visible = visibleQuestions(questions, answers);
  const answered = visible.filter((q) => isAnswered(answers[q.id])).length;
  return { answered, total: visible.length };
}

/**
 * Branch-aware answered / total questions across the whole intake, EXCLUDING intentionally-skipped sections
 * (a skipped section's questions never count as "remaining", 17 §13 / decision). Chat-only sections (no
 * questions) contribute 0/0. `sectionFor` returns a section's live status + answers by id. Pure.
 */
export function intakeQuestionTotals(
  metas: IntakeSectionMeta[],
  sectionFor: (id: string) => { status?: IntakeSectionStatus; answers: AnswerMap } | undefined,
): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const m of metas) {
    const section = sectionFor(m.id);
    if (section?.status === 'skipped') continue; // a skipped section is done — its questions aren't "remaining"
    const p = sectionProgress(m, section?.answers ?? {});
    answered += p.answered;
    total += p.total;
  }
  return { answered, total };
}

/** Overall onboarding progress, measured by section: completed (finished) + skipped out of all sections. */
export function overallProgress(
  metas: IntakeSectionMeta[],
  statusFor: (id: string) => IntakeSectionStatus | undefined,
): { completed: number; skipped: number; total: number; pct: number } {
  let completed = 0;
  let skipped = 0;
  for (const m of metas) {
    const status = statusFor(m.id);
    if (status === 'complete') completed += 1;
    else if (status === 'skipped') skipped += 1;
  }
  const total = metas.length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { completed, skipped, total, pct };
}
