import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import type { Insight, MemoryReconcileResult, UsageEvent } from '../schemas';
import { LIFE_AREAS } from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { normalizeCategories } from './categories';
import { getInsight, listInsightsForPerson, saveInsight } from './insightStore';
import { queueMergeProposals } from './mergeProposals';

/**
 * "Refresh memory" reconciliation (20-memory-dashboard §3.5/§4.3/§5.2). The MANUAL, budget-gated AI pass
 * (metered `memory.reconcile`) over ONE subject's own ACTIVE (approved) insights. It re-scores each
 * insight's `confidence` + writes a human `confidenceRationale`, re-tags `categories`, and — **conservatively**
 * — merges a clearly-duplicate insight into another (folding its non-flagged facts + appending its provenance
 * to `contributingSources`, then deleting it). It MUST NOT re-assert a fact the user flagged inaccurate.
 *
 * Privacy invariant: the prompt only ever sees the one subject's OWN insights — never another person's (the
 * caller passes the active `personId`; we load only that person's folder). Cheap: it operates on insight
 * summaries/facts (small), not raw transcripts. Automatic (riding a producer pass) category-tagging is folded
 * into each producer's existing analysis call instead — there is no automatic reconciliation call (no extra
 * spend); this AI pass runs only when the user taps Refresh.
 */

const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

/**
 * The model returns operations over the supplied insight ids — never new content, never other subjects.
 * Tolerant (37 §3.1): one malformed op (bad confidence, missing id) drops without discarding the batch.
 */
const RECONCILE_OP_SENTINEL = { id: '', confidence: 'medium' as const };
const RECONCILE_MERGE_SENTINEL = { from: '', into: '' };
const ReconcileOpsSchema = z.object({
  insights: tolerantArray(
    z.object({
      id: z.string().min(1),
      confidence: ConfidenceSchema,
      rationale: z.string().optional(),
      categories: z.array(z.string()).optional(),
    }),
    RECONCILE_OP_SENTINEL,
    (op) => op.id.trim() !== '',
  ),
  merges: tolerantArray(
    z.object({ from: z.string().min(1), into: z.string().min(1) }),
    RECONCILE_MERGE_SENTINEL,
    (m) => m.from.trim() !== '' && m.into.trim() !== '',
  ),
});

const RECONCILE_SYSTEM = `You maintain a person's private "memory" — a set of insights a wellness coach has \
gathered about them (from onboarding, coaching sessions, dreams, and questionnaires). You are NOT diagnosing \
or treating; this is reflective memory. You will be given that person's existing insights as JSON. Your job is \
to keep the memory coherent and well-calibrated WITHOUT inventing anything:
- For each insight, set a "confidence" of "low", "medium", or "high" reflecting how well-corroborated it is \
across the insights, and a short plain-English "rationale" (e.g. "echoed across 3 sessions").
- Tag each insight with 1-2 "categories" from EXACTLY this list: ${LIFE_AREAS.join(', ')}.
- CONSERVATIVELY merge: only when two insights are CLEARLY the same thing, output a merge {"from","into"}. \
Prefer adjusting confidence over merging — never collapse distinct nuances.
- A fact marked "flaggedInaccurate": true is one the PERSON says is WRONG. NEVER re-assert it, never merge it \
forward, and lower the confidence of any insight that leaned on it. Treat it as a correction.
Respond with ONLY a single JSON object (no markdown fences, no prose) of the shape:
{"insights":[{"id":"<id>","confidence":"low|medium|high","rationale":"<short>","categories":["<area>"]}],"merges":[{"from":"<id>","into":"<id>"}]}
Only reference ids that appear in the input. Output an "insights" entry for every input insight.`;

/** A compact, privacy-safe view of one insight for the reconcile prompt (no metrics / provenance noise). */
function digestInsight(insight: Insight): unknown {
  return {
    id: insight.id,
    source: insight.source,
    summary: insight.summary,
    confidence: insight.confidence,
    categories: insight.categories,
    facts: insight.facts.map((fact) => ({
      text: fact.text,
      ...(fact.flaggedInaccurate ? { flaggedInaccurate: true } : {}),
    })),
  };
}

export interface ReconcileDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  now: Date;
  override?: boolean;
}

export async function reconcileInsights(deps: ReconcileDeps): Promise<MemoryReconcileResult> {
  const { fs, key, client, apiKey, model, personId, now } = deps;
  if (!apiKey) {
    return { ok: false, reason: 'AI_OFF', message: 'Add your Claude API key to refresh memory.' };
  }

  // Only the subject's OWN approved insights are reconciled (drafts live in "Needs your review" until
  // approved). Loading just this person's folder is the privacy invariant — no other subject is ever seen.
  const active = (await listInsightsForPerson(fs, key, personId)).filter((i) => i.approved);
  if (active.length === 0) {
    return { ok: false, reason: 'NOTHING_TO_DO', message: 'There’s nothing to refresh yet.' };
  }

  const person = await checkBudget(fs, key, {
    scope: 'person',
    personId,
    now,
    override: deps.override,
  });
  const app = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (person.state === 'over' || app.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();
  let streamed;
  try {
    streamed = await client.stream(
      {
        apiKey,
        model,
        system: RECONCILE_SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(active.map(digestInsight)) }],
        maxTokens: 1500,
        // A bounded structured-JSON call — disable adaptive thinking so it can't eat the budget and truncate
        // the JSON to empty (the §17.10 thinking-budget bug). See [[adaptive-thinking-shares-maxtokens]].
        extendedThinking: false,
      },
      () => {},
    );
  } catch {
    return { ok: false, reason: 'ERROR', message: 'Couldn’t refresh memory. Please try again.' };
  }

  // Meter the paid call immediately — the tokens were spent even if parsing then fails (the 09 precedent).
  const usage: UsageEvent = {
    id: uuid(),
    schemaVersion: 1,
    type: 'memory.reconcile',
    personId,
    model,
    at,
    inputTokens: streamed.usage.inputTokens,
    outputTokens: streamed.usage.outputTokens,
    cacheWriteTokens: streamed.usage.cacheWriteTokens,
    cacheReadTokens: streamed.usage.cacheReadTokens,
    costUsd: costOf(model, streamed.usage),
  };
  await recordUsage(fs, key, usage);

  const parsed = ReconcileOpsSchema.safeParse(extractJsonObject(streamed.text));
  if (!parsed.success) {
    // Distinct honest reason (cut off vs unexpected shape vs a detected refusal) — 37 §3.2.
    const { reason, message } = classifyParseOutcome(streamed.text, 'refresh');
    return { ok: false, usage, reason, message };
  }

  const ids = new Set(active.map((i) => i.id));

  // Confirm-before-apply (39-living-memory §3.4): merges are NEVER applied silently. Each valid, distinct,
  // both-existing merge op is QUEUED as a proposal the user confirms (Merge) or dismisses (Keep both) in
  // Memory. The low-risk confidence/category recalibration below still auto-applies.
  const validMerges = parsed.data.merges.filter(
    (m) => m.from !== m.into && ids.has(m.from) && ids.has(m.into),
  );
  const summaryById = new Map(active.map((i) => [i.id, i.summary]));
  const proposedCount = await queueMergeProposals(fs, key, personId, validMerges, summaryById, now);

  // Apply per-insight confidence / rationale / category updates (auto — low risk). No insight is deleted here;
  // a merge only removes the source if/when the user accepts its proposal.
  let reconciledCount = 0;
  for (const op of parsed.data.insights) {
    if (!ids.has(op.id)) continue;
    const existing = await getInsight(fs, key, personId, op.id);
    if (!existing) continue;
    await saveInsight(fs, key, {
      ...existing,
      confidence: op.confidence,
      categories: normalizeCategories(op.categories ?? existing.categories),
      lastReconciledAt: at,
      updatedAt: at,
      ...(op.rationale?.trim() ? { confidenceRationale: op.rationale.trim() } : {}),
    });
    reconciledCount += 1;
  }

  return { ok: true, reconciledCount, mergedCount: 0, proposedCount, usage };
}
