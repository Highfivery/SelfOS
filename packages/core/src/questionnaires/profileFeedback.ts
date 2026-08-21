import type { FileSystem } from '../host';
import { getPerson } from '../people/peopleService';

import { isAnswered, isDeclined, type AnswerValue } from './answering';
import { getAssignment, getAssignmentSnapshot } from './assignmentService';
import { detectRecipientBailed, detectRecipientNumericShifts } from './changeDetection';
import {
  applyChange,
  applyDecline,
  applyEngagement,
  readProfile,
  writeProfile,
} from './personalizationProfile';
import { getResponse } from './responseService';

/**
 * Question-quality self-selection (spec 69 §5.2 / Phase 5): a response is "richly engaged" when the person
 * answered a healthy majority of its questions substantively (not skipped). Below this, we don't claim rich
 * engagement (their skips are already captured as feedback). ≥2 real answers guards a 1-question form.
 */
const RICH_ENGAGEMENT_RATIO = 0.6;
const RICH_ENGAGEMENT_MIN = 2;

/**
 * Capture the per-question declines (spec 69 §3.3 / 08 §25.5) from a just-submitted response into the
 * RECIPIENT's Personalization Profile, so future generation for that recipient learns what they didn't want
 * asked. Called after the response is persisted from every channel — in-app + email (`submitResponse`) and the
 * relay drain (`drainRelaySend`).
 *
 * Household recipients only: an external relay recipient has no `people/<id>` vault folder, so `getPerson`
 * returns null and we skip (there is nothing to persist a profile against). Best-effort: guards every read and
 * never throws out of a submit (the call sites also wrap it).
 */
export async function captureResponseFeedback(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
  now: Date = new Date(),
): Promise<void> {
  const assignment = await getAssignment(fs, key, assignmentId);
  const recipient = assignment?.recipient;
  const recipientId = recipient?.kind === 'person' ? recipient.personId : undefined;
  if (!recipientId) return;
  // External / non-household recipient → no profile to own.
  const person = await getPerson(fs, key, recipientId);
  if (!person) return;

  const snapshot = await getAssignmentSnapshot(fs, key, assignmentId);
  const response = await getResponse(fs, key, assignmentId);
  if (!snapshot || !response) return;

  const byId = new Map(response.answers.map((a) => [a.questionId, a.value] as const));
  let profile = await readProfile(fs, key, recipientId);
  let changed = false;
  const answeredPrompts: string[] = [];
  for (const q of snapshot.questions) {
    const value = byId.get(q.id) as AnswerValue | undefined;
    if (isAnswered(q, value)) {
      answeredPrompts.push(q.prompt);
      continue;
    }
    if (!isDeclined(value)) continue;
    // Stamp the ground the question covered (71 §5.3 tags it at write time), so a decline is a fact about a
    // TOPIC and not only about one wording. Without it the avoid list could only ever match the exact prompt
    // again, so "doesn't apply to me" stopped the question and not the subject — and the Explored panel had
    // nothing to hang the mark on. A question may cover more than one topic; take the first, which is the
    // primary ground the planner selected it for. Absent on a hand-authored or pre-71 question, and the
    // prompt-level behaviour is unchanged there.
    const topicId = q.topicIds?.[0]?.trim();
    profile = applyDecline(
      profile,
      {
        ...(topicId ? { topicId } : {}),
        questionPrompt: q.prompt,
        ...(value.reason ? { reason: value.reason } : {}),
        assignmentId,
      },
      now,
    );
    changed = true;
  }

  // Question-quality self-selection (spec 69 §5.2 / Phase 5): when the person engaged richly (answered a
  // healthy majority substantively), mark those questions as a productive vein — going DEEPER here (a new
  // angle, never the same question) is a justified exception to the strong-new-ground bias.
  const total = snapshot.questions.length;
  if (
    total > 0 &&
    answeredPrompts.length >= RICH_ENGAGEMENT_MIN &&
    answeredPrompts.length / total >= RICH_ENGAGEMENT_RATIO
  ) {
    for (const prompt of answeredPrompts) {
      const next = applyEngagement(profile, { questionPrompt: prompt, engagement: 'rich' }, now);
      if (next !== profile) {
        profile = next;
        changed = true;
      }
    }
  }

  // Question-quality self-selection (spec 69 §5.2 / Phase 5): a check-in they opened but abandoned (stale,
  // unsubmitted) is a "bailed" low-engagement signal → keep future questionnaires here short + simple. Keyed
  // by the assignment so re-detecting the same one refreshes rather than piles up.
  for (const bailed of await detectRecipientBailed(fs, key, recipientId, now)) {
    const next = applyEngagement(
      profile,
      { topicId: bailed.assignmentId, questionPrompt: bailed.title, engagement: 'bailed' },
      now,
    );
    if (next !== profile) {
      profile = next;
      changed = true;
    }
  }

  // spec 69 §5.8 — also detect any numeric re-ask shift ("used to say X, now Y") and log it as an unexplored
  // change, so generation can invite them to explore what changed.
  for (const shift of await detectRecipientNumericShifts(fs, key, recipientId)) {
    const next = applyChange(
      profile,
      {
        metricKey: shift.questionId,
        label: shift.prompt,
        kind: 'numeric-shift',
        from: shift.from,
        to: shift.to,
      },
      now,
    );
    if (next !== profile) {
      profile = next;
      changed = true;
    }
  }

  if (changed) await writeProfile(fs, key, profile);
}
