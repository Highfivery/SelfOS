import type { FileSystem } from '../host';
import type { Answer, Question } from '../schemas';

import { isDeclined } from './answering';
import { getAssignmentSnapshot, listAssignments } from './assignmentService';
import { getResponse } from './responseService';

/**
 * Numeric change detection (spec 69 §5.8) — a rating/slider question the recipient answered ≥2 times (a genuine
 * re-ask, aligned by the frozen question id) whose latest value moved meaningfully from the previous one. This
 * is the "used to say X, now Y" signal the raw material always supported but nothing computed. Scale-aware: a
 * shift counts only when it crosses `SHIFT_FRACTION` of the declared scale, so a 1-point wobble on a 0–100
 * slider is ignored while a 2→5 on a 1–5 rating registers.
 */

/** A shift must cross at least a quarter of the question's scale to count as a real change of mind. */
const SHIFT_FRACTION = 0.25;

export interface NumericShift {
  questionId: string;
  prompt: string;
  from: string;
  to: string;
}

interface AnsweredSend {
  submittedAt: string;
  questions: Question[];
  answers: Answer[];
}

/**
 * Detect the recipient's rating/slider re-ask shifts across all their answered questionnaires. Household
 * recipients only (the caller passes a household recipient id); host-side, author-blind. Reads each answered
 * assignment's frozen snapshot + response.
 */
export async function detectRecipientNumericShifts(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<NumericShift[]> {
  const asked = await listAssignments(fs, key, { recipientPersonId });
  const sends: AnsweredSend[] = [];
  for (const a of asked) {
    const snapshot = await getAssignmentSnapshot(fs, key, a.id);
    const response = await getResponse(fs, key, a.id);
    if (!snapshot || !response?.submittedAt) continue;
    sends.push({
      submittedAt: response.submittedAt,
      questions: snapshot.questions,
      answers: response.answers,
    });
  }
  // Chronological, so "previous" and "latest" are well-defined per question.
  sends.sort((x, y) =>
    x.submittedAt < y.submittedAt ? -1 : x.submittedAt > y.submittedAt ? 1 : 0,
  );

  const order: string[] = [];
  const repr = new Map<string, Question>();
  const values = new Map<string, number[]>();
  for (const send of sends) {
    for (const q of send.questions) {
      if (q.type !== 'rating' && q.type !== 'slider') continue;
      const answer = send.answers.find((ans) => ans.questionId === q.id);
      if (!answer || isDeclined(answer.value)) continue;
      const v = answer.value;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (!repr.has(q.id)) {
        repr.set(q.id, q);
        order.push(q.id);
      }
      const arr = values.get(q.id) ?? [];
      arr.push(v);
      values.set(q.id, arr);
    }
  }

  const shifts: NumericShift[] = [];
  for (const id of order) {
    const arr = values.get(id);
    const q = repr.get(id);
    if (!arr || !q || arr.length < 2) continue;
    const to = arr[arr.length - 1];
    const from = arr[arr.length - 2];
    if (to === undefined || from === undefined) continue;
    const span = q.scale ? Math.abs(q.scale.max - q.scale.min) : 0;
    const threshold = span > 0 ? span * SHIFT_FRACTION : 1;
    if (Math.abs(to - from) < threshold) continue;
    const fmt = (n: number): string => (q.scale ? `${n}/${q.scale.max}` : String(n));
    shifts.push({ questionId: id, prompt: q.prompt, from: fmt(from), to: fmt(to) });
  }
  return shifts;
}
