import type { FileSystem } from '../host';
import { getPerson } from '../people/peopleService';

import { isDeclined, type AnswerValue } from './answering';
import { getAssignment, getAssignmentSnapshot } from './assignmentService';
import { detectRecipientNumericShifts } from './changeDetection';
import { applyChange, applyDecline, readProfile, writeProfile } from './personalizationProfile';
import { getResponse } from './responseService';

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
  for (const q of snapshot.questions) {
    const value = byId.get(q.id) as AnswerValue | undefined;
    if (!isDeclined(value)) continue;
    profile = applyDecline(
      profile,
      {
        questionPrompt: q.prompt,
        ...(value.reason ? { reason: value.reason } : {}),
        assignmentId,
      },
      now,
    );
    changed = true;
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
