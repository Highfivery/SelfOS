/**
 * Bridges the per-person intimacy activity-matrix resolution (27 §4.2) between the catalog/renderer and the
 * intake session. `activityRowContext` pulls the two inputs the resolver needs — own anatomy (`gender`, from
 * the `basics` section) and partner anatomy (`drawnTo`, from the `intimacy` section) — out of a session, so
 * synthesis re-resolves the activity rows with the SAME context the renderer used (the keys line up). The
 * renderer reads `gender` from the profile + `drawnTo` from live answers, so it doesn't need the session.
 */

import type { IntakeSession, Question } from '../schemas';
import { type ActivityRowContext, resolveIntakeActivityRows } from '../intimacy/activityRows';

function sectionAnswers(session: IntakeSession, sectionId: string): Record<string, unknown> {
  return session.sections.find((s) => s.id === sectionId)?.answers ?? {};
}

/** Extract the activity-row context (gender + drawnTo) from a saved intake session. */
export function activityRowContext(session: IntakeSession): ActivityRowContext {
  const gender = sectionAnswers(session, 'basics')['gender'];
  const drawnTo = sectionAnswers(session, 'intimacy')['drawnTo'];
  return {
    gender: typeof gender === 'string' ? gender : undefined,
    drawnTo: Array.isArray(drawnTo)
      ? drawnTo.filter((d): d is string => typeof d === 'string')
      : undefined,
  };
}

/** Return the intimacy activity matrix question with its rows resolved for the given person; any other
 * question is returned unchanged. The single place both the renderer and synthesis tailor the rows. */
export function withResolvedActivityRows(question: Question, ctx: ActivityRowContext): Question {
  if (question.id !== 'activities' || question.type !== 'matrix' || !question.matrix) {
    return question;
  }
  return { ...question, matrix: { ...question.matrix, rows: resolveIntakeActivityRows(ctx) } };
}
