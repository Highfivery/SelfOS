/**
 * Bridges the per-person intimacy activity-matrix resolution (46-intimacy-matrix-accuracy §5) between the
 * catalog/renderer and the intake session. `activityRowContext` pulls the two inputs the resolver needs —
 * **own anatomy** (`ownAnatomy`) and **partner anatomy** (`partnerAnatomy`), both now in the **intimacy**
 * section — out of a session, so synthesis re-resolves the activity rows with the SAME context the renderer
 * used (the stable keys line up). Both reads are same-section now (simpler than the pre-46 cross-section
 * `gender` read, which was also a plumbing-bug surface — 46 §1).
 */

import type { IntakeSession, Question } from '../schemas';
import type { ActivityRowContext } from '../intimacy/activityRows';
import { resolvedActivityMatrix } from '../intimacy/grouping';

function sectionAnswers(session: IntakeSession, sectionId: string): Record<string, unknown> {
  return session.sections.find((s) => s.id === sectionId)?.answers ?? {};
}

/** Extract the activity-row context (own + partner anatomy) from a saved intake session. */
export function activityRowContext(session: IntakeSession): ActivityRowContext {
  const intimacy = sectionAnswers(session, 'intimacy');
  const ownAnatomy = intimacy['ownAnatomy'];
  const partnerAnatomy = intimacy['partnerAnatomy'];
  return {
    ownAnatomy: typeof ownAnatomy === 'string' ? ownAnatomy : undefined,
    partnerAnatomy: Array.isArray(partnerAnatomy)
      ? partnerAnatomy.filter((d): d is string => typeof d === 'string')
      : undefined,
  };
}

/** Return the intimacy activity matrix question with its rows resolved for the given person; any other
 * question is returned unchanged. The single place both the renderer and synthesis tailor the rows. */
export function withResolvedActivityRows(question: Question, ctx: ActivityRowContext): Question {
  if (question.id !== 'activities' || question.type !== 'matrix' || !question.matrix) {
    return question;
  }
  // Re-resolve rows + their category groups together so they stay in sync (49 §5).
  return { ...question, matrix: { ...question.matrix, ...resolvedActivityMatrix(ctx) } };
}
