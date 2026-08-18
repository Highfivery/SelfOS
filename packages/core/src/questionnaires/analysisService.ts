import { z } from 'zod';
import {
  classifyParseOutcome,
  extractJsonObject,
  isEmptyStructuredResult,
  salvageJsonObjectField,
  tolerantArray,
} from '../ai/jsonSalvage';
import { uuid } from '../id';
import {
  listInsightsForPerson,
  normalizeCategories,
  producedFactShare,
  saveInsight,
} from '../insights';
import { isDeclined, visibleQuestions, type AnswerMap, type AnswerValue } from './answering';
import type { Insight, QuestionnaireAnalyzeResult, ResponseSet } from '../schemas';
import { buildAnalysisSystem, buildAnalysisUserMessage } from './aiPrompts';
import { aboutFromRecipient } from './aboutResolver';
import { getAssignment, getAssignmentSnapshot } from './assignmentService';
import { runClaude, type AiDeps } from './generationService';
import { getResponse } from './responseService';
import { buildOwnSuppressionBlock } from '../tests/adaptive/steer';

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
  // A whitespace-only summary is as empty as ""; require real content so it routes to the honest EMPTY branch
  // (via `isEmptyStructuredResult`) rather than saving a near-blank Insight (37 §3.1 / 08 §22.7).
  summary: z.string().refine((s) => s.trim().length > 0),
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

/**
 * A CONTENT-FREE fingerprint of a failed analysis reply (08 §3.7) — the parse reason, how long the reply
 * was, whether it was cut off, and the model's TOP-LEVEL JSON keys (field NAMES only — never values, so no
 * answer content leaks). Surfaced on the error so a recurring "unexpected shape" tells us the actual shape
 * (e.g. the model returned `overview`/`points` instead of `summary`/`facts`) rather than staying a black box.
 */
export function analysisFailureDiagnostic(
  text: string,
  reason: string,
  truncated: boolean,
): string {
  const parsed = extractJsonObject(text);
  const shape =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? `keys: ${Object.keys(parsed as Record<string, unknown>).join(', ') || '(none)'}`
      : 'no JSON object';
  return `${reason} · ${text.length} chars · ${truncated ? 'cut off' : 'complete'} · ${shape}`;
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
  // A per-question decline (§25.5) carries no answer content and is NOT signal about the person — an
  // "unclear" is feedback about the question, a "prefer not to say" is a boundary. Exclude declines from
  // the analyzed Q→A (like a blank) so a skip never becomes an inferred fact or corrupts metrics; the skip
  // reasons feed the sender/generation loop, not the person's Insight.
  const liveAnswers = response.answers.filter(
    (a) => visibleIds.has(a.questionId) && !isDeclined(a.value as AnswerValue),
  );
  const qa = liveAnswers.flatMap((a) => {
    const q = byId.get(a.questionId);
    return q ? [{ prompt: q.prompt, answer: formatAnswer(a.value) }] : [];
  });

  // Nothing to analyze: the response was submitted but every answer is blank/skipped/declined (or only for
  // now-hidden branches). Fail honestly BEFORE spending — feeding the model an empty Q&A reliably produces a
  // conversational, non-JSON reply that then reads as the scary "unexpected shape" MALFORMED error (08 §3.7).
  if (qa.length === 0) {
    return {
      ok: false,
      reason: 'EMPTY',
      message:
        'These answers are all blank or skipped — there’s nothing to analyze into an insight yet.',
    };
  }

  // Register-aware system prompt (08 §22.7): an intimacy/scenario questionnaire at an explicit tier gets the
  // explicit analysis framing so the model synthesizes frank sexual answers into an insight instead of
  // returning valid-but-EMPTY JSON (the "unexpected shape" bug the #340 hardening couldn't fix — the answers
  // were substantive, the empty came from the missing register); standard questionnaires are unchanged.
  // The insight this writes is read back by the person whose answers it summarizes, so their hard nos apply
  // here exactly as they do to the questions themselves — generation had suppression, the read side did not.
  // An external recipient has no vault and so no lexicon — nothing known, nothing to suppress.
  const suppression =
    assignment.recipient.kind === 'person'
      ? await buildOwnSuppressionBlock(deps.fs, deps.key, assignment.recipient.personId)
      : '';
  const call = await runClaude(
    deps,
    [buildAnalysisSystem(snapshot.type, snapshot.sensitivity), suppression]
      .filter(Boolean)
      .join('\n\n'),
    buildAnalysisUserMessage({ title: snapshot.title, qa }),
    'questionnaire.analyze',
    // A summary + up to 6 facts + the JSON scaffolding can exceed a tight ceiling; give it real headroom so
    // the model isn't forced to cut the object short (you only pay for tokens generated). §17.9 keeps adaptive
    // thinking off so the whole budget goes to the output.
    2000,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // Tolerant parse; on a truncated object, salvage at least the leading `summary` so a partial result still
  // produces an Insight (37 "show any partial"). Only a genuinely-empty/no-JSON reply is classified.
  const raw = extractJsonObject(call.text);
  let data = AnalysisSchema.safeParse(raw).data;
  if (!data) {
    const summary = salvageJsonObjectField(call.text, 'summary');
    if (summary?.trim()) data = { summary, facts: [] };
  }
  if (!data) {
    // A genuinely EMPTY-but-valid reply (well-formed JSON with an empty summary AND no facts — the model had
    // nothing to say) is honest, not a "shape" problem, and retrying won't change it. This is the empty-MODEL-
    // OUTPUT case (distinct from the empty-Q&A guard above): substantive answers in, an empty result out —
    // the missing explicit register is what the §22.7 fix above closes. Surface a distinct honest message.
    if (isEmptyStructuredResult(raw)) {
      return {
        ok: false,
        reason: 'EMPTY',
        usage: call.usage,
        message: 'There wasn’t enough in these answers to draw an insight yet.',
      };
    }
    // A reply that STILL hit max_tokens after the bounded continuations is honestly "cut off", not a shape
    // problem — report TRUNCATED even if it happens to end brace-balanced (don't rely on the endsUnclosed
    // guess). Attach a content-free fingerprint so a recurring failure is diagnosable without leaking answers.
    const { reason: classified, message } = classifyParseOutcome(call.text, 'analysis');
    const reason = call.truncated ? ('TRUNCATED' as const) : classified;
    return {
      ok: false,
      reason,
      usage: call.usage,
      message,
      diagnostic: analysisFailureDiagnostic(call.text, reason, call.truncated ?? false),
    };
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
    // Default to shared-with-partner (owner decision — see producedFactShare), overriding the model's
    // per-fact broadcast guess: the default is partner-scoped, not broadcast-to-everyone.
    facts: validated.data.facts.map((f) => ({ id: uuid(), text: f.text, ...producedFactShare() })),
    confidence: validated.data.confidence ?? 'medium',
    categories: normalizeCategories(validated.data.categories ?? []),
    approved: false, // requires the approve-step before it feeds buildContext (§3.7)
    // Stamp the revision analyzed (56 §4) so a later recipient edit (a higher revision) reads as stale, and
    // WHO this send was about (#129) — the recipient, when it isn't the sender — so Memory groups it as a
    // response, not an "about you" fact. Absent for a self check-in (recipient === sender).
    provenance: {
      assignmentId: assignment.id,
      analyzedRevision: responseRevision(response),
      ...aboutFromRecipient(assignment.recipient, assignment.senderPersonId),
      at,
    },
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    ...(validated.data.crisisFlag ? { crisisFlag: true } : {}),
  };
  await saveInsight(deps.fs, deps.key, insight);
  return { ok: true, insight, usage: call.usage };
}
