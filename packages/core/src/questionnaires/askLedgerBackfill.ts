import { z } from 'zod';

import { extractJsonArray, salvageJsonArray, tolerantArray } from '../ai/jsonSalvage';
import { isDeclined, type AnswerValue } from './answering';
import {
  appendAsks,
  classifyOutcome,
  readLedger,
  writeLedger,
  type AskLedgerEntry,
  type AskOutcome,
} from './askLedger';
import { runClaude, type AiDeps } from './aiCall';
import { SAFETY } from './aiPrompts';
import { getAssignmentSnapshot, listAssignments } from './assignmentService';
import { readProfile, writeProfile } from './personalizationProfile';
import { getResponse } from './responseService';
import { ensureTopics, mintTopics, type Topic } from './topicMap';

/**
 * The one-time **ask-ledger backfill** (spec 71 §5.6).
 *
 * Everything asked before this spec carries no topic tag, so saturation and coverage would start blind and the
 * repetition the member reported would continue for weeks while history accumulated. Worse, the classifier
 * being replaced was keyword regex that credited **34.3%** of one real recipient's intimacy questions to zero
 * categories — so even the questions it *did* see were an undercount.
 *
 * This walks the person's existing sends once, classifies each question with the model (which reads the actual
 * question rather than matching keywords), mints the resulting vocabulary into their topic map, and seeds the
 * ledger — including how each answer landed, so quality saturation is correct from day one too.
 *
 * IDEMPOTENT (guarded by `backfilledAt`) and FAIL-SAFE: a failed or partial run leaves the flag unset and the
 * app behaves exactly as it did before, so it simply retries later. It never blocks a draft.
 */

const BATCH = 30;

const ClassifiedSchema = z.object({
  index: z.number().int(),
  topics: z.array(z.string()).catch([]).default([]),
  gist: z.string().catch('').default(''),
});
const CLASSIFIED_SENTINEL: z.infer<typeof ClassifiedSchema> = { index: -1, topics: [], gist: '' };

export const CLASSIFY_SYSTEM = `${SAFETY}

You label questionnaire questions with the ground they cover, so an app can remember what it has already asked someone and stop repeating itself. You are NOT writing questions and NOT answering them.

For EACH numbered question return: {"index": number (the question's number), "topics": string[] (1-2 short names for the ground it actually covers), "gist": string (at most 120 characters, what it asks, in plain words)}.

Rules:
- Prefer a label from the KNOWN GROUND list when one genuinely fits, so counts accumulate on one name instead of splitting across synonyms.
- When nothing in the list fits, name the ground plainly yourself. Being accurate matters more than reusing a listed label — a question filed under the wrong ground can be asked again forever.
- Label what the question is ABOUT, not how it is worded.
- Some questions are sexually explicit; this is a private adult wellness app and labelling them is a normal, in-policy classification task. Label them as accurately as any other question.

Return ONLY a JSON array, one object per question. No prose, no markdown fences.`;

export interface BackfillResult {
  ok: boolean;
  /** Entries written to the ledger. */
  seeded: number;
  /** Entries the model successfully tagged. */
  classified: number;
  /** True when at least one classification batch failed — the flag is NOT set, so it retries later. */
  degraded: boolean;
}

/**
 * Seed one person's ask ledger from their existing sends. Safe to call repeatedly — a completed backfill
 * returns immediately, and `mergeEntries` makes a re-run of a partial one a no-op for what already landed.
 */
export async function backfillAskLedger(
  deps: AiDeps,
  recipientPersonId: string,
): Promise<BackfillResult> {
  const existing = await readLedger(deps.fs, deps.key, recipientPersonId);
  if (existing.backfilledAt) return { ok: true, seeded: 0, classified: 0, degraded: false };

  // The ONE place a full scan is correct: this runs once per person, not per draft.
  const assignments = await listAssignments(deps.fs, deps.key, { recipientPersonId });
  const raw: { entry: AskLedgerEntry; prompt: string }[] = [];
  for (const assignment of assignments) {
    const snapshot = await getAssignmentSnapshot(deps.fs, deps.key, assignment.id);
    if (!snapshot) continue;
    const response = await getResponse(deps.fs, deps.key, assignment.id);
    const answered = new Map(
      (response?.answers ?? []).map((a) => [a.questionId, a.value as AnswerValue | undefined]),
    );
    for (const q of snapshot.questions) {
      // A send nobody has submitted yet is genuinely `pending`, not a skip — only a SUBMITTED response tells
      // us a question was passed over.
      const outcome: AskOutcome = response?.submittedAt
        ? classifyOutcome(q, answered.get(q.id))
        : 'pending';
      raw.push({
        entry: {
          questionId: q.id,
          assignmentId: assignment.id,
          at: assignment.createdAt,
          type: snapshot.type,
          tier: snapshot.sensitivity,
          topicIds: q.topicIds ?? [],
          gist: q.gist ?? '',
          outcome:
            outcome === 'pending' && answered.has(q.id) && isDeclined(answered.get(q.id))
              ? 'declined'
              : outcome,
        },
        prompt: q.prompt,
      });
    }
  }
  if (raw.length === 0) {
    await writeLedger(deps.fs, deps.key, {
      ...existing,
      backfilledAt: deps.now.toISOString(),
    });
    return { ok: true, seeded: 0, classified: 0, degraded: false };
  }

  const profile = await readProfile(deps.fs, deps.key, recipientPersonId);
  let topics: Topic[] = ensureTopics(profile.topics);
  let classified = 0;
  let degraded = false;

  const untagged = raw.filter((r) => r.entry.topicIds.length === 0);
  for (let i = 0; i < untagged.length; i += BATCH) {
    const batch = untagged.slice(i, i + BATCH);
    const known = topics.map((t) => `- ${t.label}`).join('\n');
    const user = [
      `KNOWN GROUND (reuse a label from here when it genuinely fits):\n${known}`,
      `\nQUESTIONS:\n${batch.map((b, n) => `${n + 1}. ${b.prompt}`).join('\n')}`,
      `\nReturn the JSON array of ${batch.length} objects.`,
    ].join('\n');
    const call = await runClaude(deps, CLASSIFY_SYSTEM, user, 'questionnaire.classify', 3000);
    if (!call.ok) {
      degraded = true;
      continue; // leave this batch untagged; a later run retries it
    }
    const whole = extractJsonArray(call.text);
    const parsed = tolerantArray(ClassifiedSchema, CLASSIFIED_SENTINEL, (c) => c.index >= 1).parse(
      Array.isArray(whole) ? whole : salvageJsonArray(call.text),
    );
    if (parsed.length === 0) {
      degraded = true;
      continue;
    }
    for (const c of parsed) {
      const target = batch[c.index - 1];
      if (!target) continue;
      const labels = c.topics.map((l) => l.trim()).filter((l) => l !== '');
      if (labels.length === 0) continue;
      const minted = mintTopics(
        topics,
        labels.map((label) => ({ label })),
      );
      topics = minted.topics;
      target.entry.topicIds = minted.resolved;
      if (c.gist.trim() !== '') target.entry.gist = c.gist.trim().slice(0, 120);
      classified += 1;
    }
  }

  await appendAsks(
    deps.fs,
    deps.key,
    recipientPersonId,
    raw.map((r) => r.entry),
  );
  // Persist the grown vocabulary alongside the ledger it describes.
  const after = await readProfile(deps.fs, deps.key, recipientPersonId);
  await writeProfile(deps.fs, deps.key, {
    ...after,
    topics,
    updatedAt: deps.now.toISOString(),
  });
  // Only flag DONE on a clean run — a degraded pass must retry, or a third of the history stays invisible,
  // which is exactly the failure mode this replaces.
  if (!degraded) {
    const ledger = await readLedger(deps.fs, deps.key, recipientPersonId);
    await writeLedger(deps.fs, deps.key, { ...ledger, backfilledAt: deps.now.toISOString() });
  }
  return { ok: true, seeded: raw.length, classified, degraded };
}
