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
import { ensureTopics, mintTopics, rollUpCategoryLabels, type Topic } from './topicMap';

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

/**
 * The tagging contract's version. Bumping it makes the next reconcile RE-CLASSIFY an already-backfilled
 * ledger, so a correction to how questions are filed reaches existing history instead of only new asks.
 *
 * v3 records the family as each specific topic's PARENT so closure is inherited; v2 added the mandatory roll-up category (§5.3); v1 filed a question only under its specific name, which
 * fragmented families — real measurement after v1 was 13 threesome asks spread across five topics while the
 * built-in `Group & swinging` still read as untouched and OPEN.
 */
export const TAGGING_VERSION = 4;

const ClassifiedSchema = z.object({
  index: z.number().int(),
  /** The broad family — the ROLL-UP tag that makes a fragmented family saturate (§5.3). */
  category: z.string().catch('').default(''),
  topics: z.array(z.string()).catch([]).default([]),
  gist: z.string().catch('').default(''),
});
const CLASSIFIED_SENTINEL: z.infer<typeof ClassifiedSchema> = {
  index: -1,
  category: '',
  topics: [],
  gist: '',
};

export const CLASSIFY_SYSTEM = `${SAFETY}

You label questionnaire questions with the ground they cover, so an app can remember what it has already asked someone and stop repeating itself. You are NOT writing questions and NOT answering them.

For EACH numbered question return: {"index": number (the question's number), "category": string (the ONE closest label from the CATEGORIES list — always required, always from that list), "topics": string[] (1-2 short, SPECIFIC names for the ground it actually covers; may be new names you invent), "gist": string (at most 120 characters, what it asks, in plain words)}.

Rules:
- "category" MUST be copied exactly from the CATEGORIES list. It is the broad family this belongs to, and it is what lets the app notice a family has been worked through even when each question was filed under a different specific name. Never invent a category, never leave it out, and always pick the closest one even when the fit is loose.
- "topics" is the opposite: as specific as the question really is. Reuse a name from KNOWN GROUND when one genuinely fits so counts accumulate; otherwise name it plainly yourself.
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
  // A completed backfill is a no-op UNLESS the tagging contract has moved on, in which case every entry is
  // re-classified — a filing correction is worthless if it only ever reaches questions asked after it.
  const retag = (existing.taggingVersion ?? 1) < TAGGING_VERSION;
  if (existing.backfilledAt && !retag) {
    return { ok: true, seeded: 0, classified: 0, degraded: false };
  }

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
      taggingVersion: TAGGING_VERSION,
    });
    return { ok: true, seeded: 0, classified: 0, degraded: false };
  }

  const profile = await readProfile(deps.fs, deps.key, recipientPersonId);
  let topics: Topic[] = ensureTopics(profile.topics);
  let classified = 0;
  let degraded = false;

  const untagged = retag ? raw : raw.filter((r) => r.entry.topicIds.length === 0);
  for (let i = 0; i < untagged.length; i += BATCH) {
    const batch = untagged.slice(i, i + BATCH);
    const known = topics.map((t) => `- ${t.label}`).join('\n');
    const categories = rollUpCategoryLabels()
      .map((l) => `- ${l}`)
      .join('\n');
    const user = [
      `CATEGORIES — pick exactly ONE of these as "category" for every question:\n${categories}`,
      `\nKNOWN GROUND (reuse a specific label from here when it genuinely fits):\n${known}`,
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
      // The roll-up family is resolved FIRST so the specific ground can be minted as its child. Both tags are
      // credited by `deriveTopicStats`, so a family saturates on its total even when every question was filed
      // under a different specific name — and the child inherits the family's closure.
      const family = c.category.trim();
      const specifics = c.topics.map((l) => l.trim()).filter((l) => l !== '');
      if (family === '' && specifics.length === 0) continue;
      const ids: string[] = [];
      let parentTopicId: string | undefined;
      if (family !== '') {
        const m = mintTopics(topics, [{ label: family }]);
        topics = m.topics;
        parentTopicId = m.resolved[0];
        if (parentTopicId) ids.push(parentTopicId);
      }
      if (specifics.length > 0) {
        const m = mintTopics(
          topics,
          specifics.map((label) => ({ label, ...(parentTopicId ? { parentTopicId } : {}) })),
        );
        topics = m.topics;
        ids.push(...m.resolved.filter((id) => id !== parentTopicId));
      }
      if (ids.length === 0) continue;
      target.entry.topicIds = ids;
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
    await writeLedger(deps.fs, deps.key, {
      ...ledger,
      backfilledAt: deps.now.toISOString(),
      taggingVersion: TAGGING_VERSION,
    });
  }
  return { ok: true, seeded: raw.length, classified, degraded };
}
