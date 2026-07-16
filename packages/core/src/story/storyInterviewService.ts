import type { AiFailureReason, QuestionnaireInput } from '../schemas';
import { createAssignment } from '../questionnaires/assignmentService';
import { type AiDeps, generateQuestions } from '../questionnaires/generationService';
import { saveQuestionnaire, validateQuestionnaire } from '../questionnaires/questionnaireService';

/**
 * The Your Story interview bridge (64-your-story §3.3.2/§5.5) — the ONE path that turns a to-do into a targeted
 * story check-in. It reuses the existing questionnaire pipeline verbatim (`generateQuestions` → `saveQuestionnaire`
 * → `createAssignment`), differing only in the FOCUS (the to-do text) and the `storyProvenance` stamp. The full
 * interview engine (the McAdams gap pass) is a later phase; this is the single mint the markup layer needs.
 *
 * The check-in is a SELF-send: the book's subject is the active person, so the questions are for them, delivered
 * to their own Inbox with the biographer eyebrow. Metered `questionnaire.generate` via `generateQuestions` +
 * budget-gated; the caller (bridge) also short-circuits when AI is off.
 */

const STORY_CHECKIN_COUNT = 4;

export type StoryCheckInResult =
  | { ok: true; assignmentId: string }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Mint a story check-in whose FOCUS is the given to-do text, delivered as an in-app self-send. Returns the new
 * assignment id (so the caller can stamp the to-do `questionsSent` + `assignmentId`), or an honest failure —
 * on which NOTHING is persisted (no orphan questionnaire, no half-sent to-do).
 */
export async function mintStoryCheckInFromTodo(
  deps: AiDeps,
  args: { bookId: string; focus: string },
): Promise<StoryCheckInResult> {
  const focus = args.focus.trim();
  if (focus.length === 0) {
    return { ok: false, reason: 'ERROR', message: 'This to-do has no text to ask about.' };
  }

  const gen = await generateQuestions(deps, {
    type: 'general',
    sensitivity: 'standard',
    brief: `Your biographer wants to go deeper on this for the book: ${focus}`,
    context: {
      authorPersonId: deps.personId,
      includeAuthor: true,
      includeTarget: false,
      includeRelationship: false,
    },
    existingPrompts: [],
    count: STORY_CHECKIN_COUNT,
  });
  if (!gen.ok) {
    return {
      ok: false,
      reason: gen.reason ?? 'ERROR',
      message: gen.message ?? 'Couldn’t generate those questions. Try again.',
    };
  }
  const questions = gen.questions ?? [];
  if (questions.length === 0) {
    return { ok: false, reason: 'MALFORMED', message: 'No questions came back — try again.' };
  }

  const draft: QuestionnaireInput = {
    title: gen.title?.trim() || 'A few questions for your story',
    type: 'general',
    sensitivity: 'standard',
    recipient: { kind: 'person', personId: deps.personId },
    questions,
    storyProvenance: {
      bookId: args.bookId,
      gapBrief: focus.slice(0, 280),
      generatedAt: deps.now.toISOString(),
    },
  };
  // Generation can emit an authoring-only answer type (matrix/allocation/…) that `createAssignment` would
  // reject by throwing — pre-validate so a bad draft fails cleanly with nothing persisted.
  if (validateQuestionnaire(draft).length > 0) {
    return {
      ok: false,
      reason: 'MALFORMED',
      message: 'Those questions didn’t come out sendable — try again.',
    };
  }

  try {
    const questionnaire = await saveQuestionnaire(deps.fs, deps.key, draft, deps.personId);
    const assignment = await createAssignment(deps.fs, deps.key, {
      questionnaireId: questionnaire.id,
      senderPersonId: deps.personId,
      recipient: { kind: 'person', personId: deps.personId },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    return { ok: true, assignmentId: assignment.id };
  } catch {
    return { ok: false, reason: 'ERROR', message: 'Couldn’t send those questions. Try again.' };
  }
}
