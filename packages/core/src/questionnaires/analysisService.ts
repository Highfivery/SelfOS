import { z } from 'zod';
import {
  classifyParseOutcome,
  extractJsonObject,
  salvageJsonObjectField,
  tolerantArray,
} from '../ai/jsonSalvage';
import { uuid } from '../id';
import { listInsightsForPerson, normalizeCategories, saveInsight } from '../insights';
import { visibleQuestions, type AnswerMap, type AnswerValue } from './answering';
import type { Insight, QuestionnaireAnalyzeResult, ResponseSet } from '../schemas';
import { ANALYSIS_SYSTEM, buildAnalysisUserMessage } from './aiPrompts';
import { getAssignment, getAssignmentSnapshot } from './assignmentService';
import { runClaude, type AiDeps } from './generationService';
import { getResponse } from './responseService';

// Re-exported so existing importers (alignmentService, tests) keep one source of truth for the extractor.
export { extractJsonObject } from '../ai/jsonSalvage';

/**
 * Questionnaire **analysis** (08-questionnaires §3.7/§13.4): turn a recipient's submitted answers into a
 * durable, source-discriminated **Insight** for the coach. Budget-gated + metered (`questionnaire.analyze`)
 * like generation. The Insight is saved **unapproved** — it only enters `buildContext` after the sender
 * reviews + approves it (the approve-step). Raw answers are never exposed to the user; what's produced is
 * the **derived** Insight. A model-based **crisis flag** (§8.2) is carried through, never a keyword scan.
 *
 * The live trigger (Analyze on a received response) wires up with the Inbox/Results in §13.5; the engine +
 * the Memory surface are built here.
 */

// Tolerant by design (37 §3.1): require only `summary`; a bad fact catches to a droppable sentinel; the
// `crisisFlag` is preserved (.catch(undefined), never coerced — §8) so a per-fact salvage can't drop it.
const FACT_SENTINEL = { text: '', shareable: false };
const AnalysisSchema = z.object({
  summary: z.string().min(1),
  facts: tolerantArray(
    z.object({ text: z.string().min(1), shareable: z.boolean() }),
    FACT_SENTINEL,
    (f) => f.text.trim() !== '',
  ),
  confidence: z.enum(['low', 'medium', 'high']).optional().catch(undefined),
  crisisFlag: z.boolean().optional().catch(undefined),
  categories: z.array(z.string()).catch([]).optional(),
});

/** A response's effective revision (56 §4): a pre-56 submitted response with no `revision` reads as 1. */
export function responseRevision(response: ResponseSet): number {
  return response.revision ?? 1;
}

/**
 * Whether a send's analysis is out of date because the recipient edited + resubmitted after it was analyzed
 * (56 §3.2). True only when an analysis Insight exists AND the current response revision is past the revision
 * the Insight was built from (`analyzedRevision`, defaulting to 1 for a pre-56 insight — so an un-edited send
 * is never falsely flagged). A never-analyzed send is never "stale" (the sender simply hasn't analyzed yet).
 */
export function isAnalysisStale(
  response: ResponseSet | null | undefined,
  insight: Insight | null | undefined,
): boolean {
  if (!response || response.submittedAt === undefined || !insight) return false;
  const analyzedRevision = insight.provenance.analyzedRevision ?? 1;
  return responseRevision(response) > analyzedRevision;
}

function formatAnswer(value: AnswerValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  }
  return String(value);
}

/** Analyze the submitted answers for one assignment → a saved (unapproved) Insight. */
export async function analyzeAssignment(
  deps: AiDeps,
  input: { assignmentId: string },
): Promise<QuestionnaireAnalyzeResult> {
  const assignment = await getAssignment(deps.fs, deps.key, input.assignmentId);
  const snapshot = await getAssignmentSnapshot(deps.fs, deps.key, input.assignmentId);
  const response = await getResponse(deps.fs, deps.key, input.assignmentId);
  // Only a SUBMITTED response is analyzable. Since §13.5 a saved-but-unsubmitted draft also persists
  // as a `ResponseSet` (no `submittedAt`), guard on submission so we never derive an Insight — or burn
  // budget — from in-progress answers.
  if (!assignment || !snapshot || !response || response.submittedAt === undefined) {
    return { ok: false, reason: 'NO_RESPONSE', message: 'There are no answers to analyze yet.' };
  }

  const byId = new Map(snapshot.questions.map((q) => [q.id, q]));
  // Defensively drop answers for questions a branch now hides (47 §3.3/§7): the submit paths already filter
  // orphans, but a draft persisted before that fix could still carry a cleared-trigger answer — never analyze
  // (or meter on) one as if it were chosen.
  const answerMap: AnswerMap = Object.fromEntries(
    response.answers.map((a) => [a.questionId, a.value as AnswerValue]),
  );
  const visibleIds = new Set(visibleQuestions(snapshot.questions, answerMap).map((q) => q.id));
  const liveAnswers = response.answers.filter((a) => visibleIds.has(a.questionId));
  const qa = liveAnswers.flatMap((a) => {
    const q = byId.get(a.questionId);
    return q ? [{ prompt: q.prompt, answer: formatAnswer(a.value) }] : [];
  });

  const call = await runClaude(
    deps,
    ANALYSIS_SYSTEM,
    buildAnalysisUserMessage({ title: snapshot.title, qa }),
    'questionnaire.analyze',
    800,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // Tolerant parse; on a truncated object, salvage at least the leading `summary` so a partial result still
  // produces an Insight (37 "show any partial"). Only a genuinely-empty/no-JSON reply is classified.
  let data = AnalysisSchema.safeParse(extractJsonObject(call.text)).data;
  if (!data) {
    const summary = salvageJsonObjectField(call.text, 'summary');
    if (summary?.trim()) data = { summary, facts: [] };
  }
  if (!data) {
    const { reason, message } = classifyParseOutcome(call.text, 'analysis');
    return { ok: false, reason, usage: call.usage, message };
  }
  const validated = { data } as const;

  // Metrics from questions that declared a `metricKey` (§4.3) — forward-compatible; empty until
  // metricKey authoring (owned by spec 11) exists, so today this stays {} for normal questionnaires.
  const metrics: Record<string, number> = {};
  for (const a of liveAnswers) {
    const q = byId.get(a.questionId);
    if (q?.metricKey && typeof a.value === 'number') metrics[q.metricKey] = a.value;
  }

  // Re-analyzing the same assignment overwrites its existing Insight (reuse id + createdAt) rather than
  // duplicating — important once §13.5 wires the Analyze trigger + autoAnalyze. A re-analysis resets the
  // Insight to unapproved so the sender re-reviews it.
  const at = deps.now.toISOString();
  const prior = (await listInsightsForPerson(deps.fs, deps.key, assignment.senderPersonId)).find(
    (i) => i.provenance.assignmentId === assignment.id,
  );
  const insight: Insight = {
    id: prior?.id ?? uuid(),
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: assignment.senderPersonId, // the Insight informs the SENDER's coaching (§1)
    summary: validated.data.summary,
    facts: validated.data.facts.map((f) => ({ id: uuid(), text: f.text, shareable: f.shareable })),
    confidence: validated.data.confidence ?? 'medium',
    categories: normalizeCategories(validated.data.categories ?? []),
    approved: false, // requires the approve-step before it feeds buildContext (§3.7)
    // Stamp the revision analyzed (56 §4) so a later recipient edit (a higher revision) reads as stale.
    provenance: { assignmentId: assignment.id, analyzedRevision: responseRevision(response), at },
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    ...(validated.data.crisisFlag ? { crisisFlag: true } : {}),
  };
  await saveInsight(deps.fs, deps.key, insight);
  return { ok: true, insight, usage: call.usage };
}
