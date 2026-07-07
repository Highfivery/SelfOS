import { visibleQuestions } from '@selfos/core/questionnaires';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import type { IntakeSectionMeta, IntakeState } from '@shared/channels';

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

export interface OnboardingAttention {
  /** Section ids with something outstanding, in catalog order (drives the area count). */
  areas: string[];
  /** The "needs attention" total — visible unanswered questions worth flagging + new chat topics. */
  total: number;
}

/** The catalog as it stood when onboarding last completed/refreshed (a section/question absent here is NEW). */
export interface OnboardingSnapshot {
  knownSectionIds?: string[];
  knownQuestionKeys?: string[];
}

/**
 * What genuinely needs the person's attention in a **completed** onboarding (55-onboarding-attention §5), the
 * "new + left-unfinished" rule (#109). A currently-visible unanswered question counts when it is either:
 *   - **new** — its `sectionId.questionId` is not in the completion `snapshot` (added by a later app update,
 *     which also covers a whole new section — all its questions are new), OR
 *   - **a blank in a section left `inProgress`** — one the person started but didn't finish.
 * Every intake question is optional, so a `complete` section normally has intentional blanks (skipped optional
 * questions); flagging those would nag forever — so a `complete` section contributes only its NEW questions, and
 * a deep `notStarted`/`skipped` section its NEW ones too (never its known ones). A **new** chat section (no
 * questions) that's un-started counts as one topic. Branch-aware (only visible questions) and 18+-aware (an
 * `adult` section is excluded until the ack). With no snapshot (a pre-55 session before it's baselined) nothing
 * reads as new — only an in-progress section's blanks count — so existing users are never retroactively nagged.
 * Pure + tested; callers gate on `session.status === 'complete'`.
 */
export function onboardingAttention(
  metas: IntakeSectionMeta[],
  sectionFor: (id: string) => { status?: IntakeSectionStatus; answers: AnswerMap } | undefined,
  opts: { adultAcknowledged: boolean } & OnboardingSnapshot,
): OnboardingAttention {
  const hasSnapshot = opts.knownQuestionKeys !== undefined;
  const knownQuestions = new Set(opts.knownQuestionKeys ?? []);
  const knownSections = new Set(opts.knownSectionIds ?? []);
  let total = 0;
  const areas: string[] = [];
  for (const m of metas) {
    if (m.adult && !opts.adultAcknowledged) continue; // never nag about locked 18+ content
    const section = sectionFor(m.id);
    const status = section?.status;
    // A section the person started but didn't finish — its blanks are genuinely unfinished, not intentional
    // skips (a `complete` section's optional blanks are deliberate; only NEW questions there count).
    const engaged = status === 'inProgress';
    let count = 0;
    if (m.mode === 'chat') {
      // A chat section has no per-question count; flag it only when it is genuinely NEW (added by an update)
      // and not yet done — never a deep topic the person simply hasn't gotten to.
      if (
        hasSnapshot &&
        !knownSections.has(m.id) &&
        (status === 'notStarted' || status === 'skipped')
      ) {
        count = 1;
      }
    } else {
      const answers = section?.answers ?? {};
      for (const q of visibleQuestions(m.questions ?? [], answers)) {
        if (isAnswered(answers[q.id])) continue;
        const isNew = hasSnapshot && !knownQuestions.has(`${m.id}.${q.id}`);
        if (isNew || engaged) count += 1;
      }
    }
    if (count > 0) {
      total += count;
      areas.push(m.id);
    }
  }
  return { areas, total };
}

/** `onboardingAttention` fed straight from a loaded `IntakeState` — the one place the metas + snapshot + ack are
 * assembled, so the three consumers (Home card, nav dot, notification) can't drift. Callers still gate on
 * `state.session.status === 'complete'`. */
export function attentionFromIntakeState(state: IntakeState): OnboardingAttention {
  const byId = new Map(state.session.sections.map((s) => [s.id, s]));
  return onboardingAttention(
    state.sections,
    (id) => {
      const s = byId.get(id);
      return s ? { status: s.status, answers: s.answers as AnswerMap } : undefined;
    },
    {
      adultAcknowledged: state.adultAcknowledged,
      ...(state.session.knownSectionIds ? { knownSectionIds: state.session.knownSectionIds } : {}),
      ...(state.session.knownQuestionKeys
        ? { knownQuestionKeys: state.session.knownQuestionKeys }
        : {}),
    },
  );
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
