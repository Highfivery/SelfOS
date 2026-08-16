import type { FileSystem } from '../../host';
import { appendAsks, type AskLedgerEntry } from '../../questionnaires/askLedger';

/**
 * 74-adaptive-tests §5.6 — the **saturation write-back**.
 *
 * The owner chose for the test to COEXIST with the five surfaces that already touch dirty talk rather than
 * retire any of them — which leaves one hole worth closing: the questionnaire planner would happily keep
 * mining `Intimacy:dirty-talk` the week after someone spent twenty minutes mapping exactly that. Spec 71 §1
 * measured that ground being re-asked *7+ times in near-identical wording*; a deep test that doesn't tell the
 * planner it happened would make that worse, not better.
 *
 * So a completed take appends ask-ledger entries for the topics its instrument declares it covers. They are
 * ordinary entries — `deriveTopicStats` counts them like any other ask — so the planner treats the ground as
 * worked through and moves on, and `DORMANT_DAYS` reopens it on the usual horizon. Nothing about the ledger
 * changes; this is a new WRITER, not a new mechanism.
 *
 * Idempotent by construction: the synthetic `questionId` is derived from the result id, and `appendAsks`
 * merges by `questionId`, so re-running a completed take is a no-op rather than double-counting the ground.
 */

/** How many asks one completed take is worth per topic. `SATURATION_ASKS` is 3, so a take closes the ground
 *  in one go — which is the honest reading: the test asked more about it than three questionnaires would. */
const ASKS_PER_TAKE = 3;

/**
 * Append the ledger entries for a completed adaptive take. Best-effort at the call site — a ledger write must
 * never be part of a take's success contract (the `appendAsks` precedent).
 */
export async function recordTakeSaturation(
  fs: FileSystem,
  key: Uint8Array,
  input: {
    personId: string;
    resultId: string;
    testId: string;
    /** The topic ids this instrument covers, e.g. `['Intimacy:dirty-talk']`. */
    topicIds: readonly string[];
    /** What the take actually worked through, one short line — the ledger's `gist`. */
    gist: string;
    at: string;
  },
): Promise<void> {
  if (input.topicIds.length === 0) return;
  const entries: AskLedgerEntry[] = [];
  for (let n = 0; n < ASKS_PER_TAKE; n += 1) {
    entries.push({
      // Synthetic, deterministic, and namespaced by the test so it can never collide with a real question id.
      questionId: `test:${input.resultId}:${n}`,
      assignmentId: `test:${input.resultId}`,
      at: input.at,
      type: 'intimacy',
      tier: 'unfiltered',
      topicIds: [...input.topicIds],
      gist: input.gist,
      // A take is the richest answer this ground will ever get — never a dead vein.
      outcome: 'rich',
    });
  }
  await appendAsks(fs, key, input.personId, entries);
}
