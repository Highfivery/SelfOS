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
import {
  isAnswered,
  isDeclined,
  skipKindOf,
  visibleQuestions,
  type AnswerMap,
  type AnswerValue,
} from './answering';
import type {
  Assignment,
  Insight,
  Questionnaire,
  QuestionnaireAnalyzeResult,
  ResponseSet,
} from '../schemas';
import {
  buildAnalysisSystem,
  buildAnalysisUserMessage,
  buildRefusalUserMessage,
  REFUSAL_ANALYSIS_SYSTEM,
  type SkipLine,
} from './aiPrompts';
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
 * the **derived** Insight.
 *
 * The live trigger (Analyze on a received response) wires up with the Inbox/Results in §13.5; the engine +
 * the Memory surface are built here.
 */

// Tolerant by design (37 §3.1): require only `summary`; a bad fact catches to a droppable sentinel; the
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
  // Gate on isAnswered, not merely "not declined": a blank-but-not-declined value ('' , or [] after
  // unchecking a multiChoice) is not an answer. Without this it reached the model as an empty `A:` AND was
  // listed as refused below — the same question twice, one of them a lie.
  const liveAnswers = response.answers.filter((a) => {
    if (!visibleIds.has(a.questionId)) return false;
    const q = byId.get(a.questionId);
    return q ? isAnswered(q, a.value as AnswerValue) : false;
  });
  const qa = liveAnswers.flatMap((a) => {
    const q = byId.get(a.questionId);
    return q ? [{ prompt: q.prompt, answer: formatAnswer(a.value) }] : [];
  });

  // What came back refused, and whether we may tell the model about it at all (08 §34.3).
  //
  // A PRIVATE send tells it NOTHING — not the reasons, not even which questions were skipped. The reason
  // text is obviously out: it is the recipient's own words, and they were shown "they won't see your written
  // answers". But the per-question mapping is out too, and that took deciding rather than assuming. A
  // private sender has no route to it anywhere else — raw answers are withheld at the bridge, the Results
  // aggregate excludes private sends outright, and the card's `SkipSummary` is counts with no question
  // attached — while the insight summary this call produces IS a thing that crosses back. Passing "she
  // preferred not to say about her mother" would therefore hand the sender a fact the whole mode exists to
  // keep from them, one paraphrase removed. Owner's call, 2026-08-20: counts by kind, and nothing per
  // question. A Standard send gets the lot, which is where the reword signal was always meant to live.
  const tellReasons = assignment.privacy === 'standard';
  const skips: SkipLine[] = !tellReasons
    ? []
    : snapshot.questions
        .filter((q) => visibleIds.has(q.id) && !isAnswered(q, answerMap[q.id]))
        .map((q) => {
          const value = answerMap[q.id];
          const reason = isDeclined(value) ? value.reason?.trim() : undefined;
          return {
            prompt: q.prompt,
            kind: isDeclined(value) ? skipKindOf(value.reason) : 'other',
            ...(reason ? { reason } : {}),
          };
        });

  // Nothing to analyze: the response was submitted but every answer is blank/skipped/declined (or only for
  // now-hidden branches). Feeding the model an empty Q&A reliably produces a conversational, non-JSON reply
  // that reads as the scary "unexpected shape" MALFORMED error (08 §3.7) — so we never do that. On a STANDARD
  // send we can still read the refusal itself, which is what the sender actually needs ("why didn't this
  // land?"); on a Private one there is nothing we are allowed to say, so it stays an honest EMPTY with no
  // spend (the card shows the counts, which never leave the bridge as text).
  if (qa.length === 0) {
    if (!tellReasons || skips.length === 0) {
      return {
        ok: false,
        reason: 'EMPTY',
        message:
          'These answers are all blank or skipped — there’s nothing to analyze into an insight yet.',
      };
    }
    return analyzeRefusal(deps, { assignment, snapshot, response, skips });
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
    buildAnalysisUserMessage({ title: snapshot.title, qa, skips }),
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
  };
  await saveInsight(deps.fs, deps.key, insight);
  return { ok: true, insight, usage: call.usage };
}

/**
 * The read of a REFUSAL (08 §34.3) — a Standard send whose every question came back unanswered. The sender's
 * real question here is "why didn't this land?", and that is answerable from the refusals alone.
 *
 * Three deliberate departures from the ordinary analysis, all for the same reason — the subject of this
 * Insight is the QUESTIONNAIRE, not the person:
 *   1. Its facts are `shareable: false`. An ordinary analysis fact defaults to partner-shared (the 2026-07-17
 *      owner decision); notes about a person's refusals must not travel on that default.
 *   2. Its prompt forbids inferring anything about the person, which is what §25.5 excludes declines from the
 *      normal Q&A to prevent.
 *   3. It never carries `metrics` — there are no answers to derive them from, and a
 * Standard-only is enforced by the caller: on a Private send the summary would cross back to the sender, and
 * a paraphrase of why she refused breaches the same promise the counts protect (§34.2).
 */
async function analyzeRefusal(
  deps: AiDeps,
  input: {
    assignment: Assignment;
    snapshot: Questionnaire;
    response: ResponseSet;
    skips: SkipLine[];
  },
): Promise<QuestionnaireAnalyzeResult> {
  const { assignment, snapshot, response, skips } = input;
  // BEFORE spending. `saveInsight` replaces the whole record, so reusing the id of a real analysis would
  // withdraws their answers and resubmits empty. Only ever overwrite a previous REFUSAL read. This check has
  // to come first because the caller may be `autoAnalyze`: leave it below the model call and that path bills
  // a read on every re-open of the sender's Results and then throws the answer away, with no user action at
  // all. The sibling path fails honestly before spending for the same reason.
  const prior = (await listInsightsForPerson(deps.fs, deps.key, assignment.senderPersonId)).find(
    (i) => i.provenance.assignmentId === assignment.id,
  );
  if (prior && prior.provenance.refusalRead !== true) {
    return {
      ok: false,
      reason: 'EMPTY',
      message:
        'Nothing was answered this time — the insight from the earlier answers is still in your Memory.',
    };
  }

  // §5.8a: suppression is UNCONDITIONAL on any path that writes prose a person reads, and this is one — it
  // quotes the recipient's own words into the prompt and produces a summary the sender reads back.
  const suppression =
    assignment.recipient.kind === 'person'
      ? await buildOwnSuppressionBlock(deps.fs, deps.key, assignment.recipient.personId)
      : '';
  const call = await runClaude(
    deps,
    [REFUSAL_ANALYSIS_SYSTEM, suppression].filter(Boolean).join('\n\n'),
    buildRefusalUserMessage({ title: snapshot.title, skips }),
    'questionnaire.analyze',
    1200,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const raw = extractJsonObject(call.text);
  const parsed = raw ? AnalysisSchema.safeParse(raw) : undefined;
  if (!parsed?.success) {
    // A valid-but-empty reply is an EMPTY outcome, not a shape problem — say so plainly rather than raising
    // the "unexpected shape" error, which reads as broken and invites a pointless (billed) retry.
    if (isEmptyStructuredResult(raw)) {
      return {
        ok: false,
        reason: 'EMPTY',
        usage: call.usage,
        message: 'There wasn’t enough in these skipped questions to draw anything from yet.',
      };
    }
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

  const at = deps.now.toISOString();
  const insight: Insight = {
    id: prior?.id ?? uuid(),
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: assignment.senderPersonId,
    summary: parsed.data.summary,
    // `shareableTypes: []` is EXPLICIT-private and is load-bearing. `shareable: false` alone is not enough:
    // that is byte-for-byte the shape `isDefaultPrivate` matches, so the partner-share backfill
    // (`ensurePartnerShareBackfill`, run on the first Memory read) would stamp `['partner']` on it — and on a
    // Standard send these fact texts are derived from the recipient's own words. An explicit empty scope is
    // preserved by the backfill; an absent one is treated as never-configured.
    facts: parsed.data.facts.map((f) => ({
      id: uuid(),
      text: f.text,
      shareable: false,
      shareableTypes: [],
    })),
    confidence: parsed.data.confidence ?? 'low',
    categories: normalizeCategories(parsed.data.categories ?? []),
    approved: false,
    provenance: {
      assignmentId: assignment.id,
      analyzedRevision: responseRevision(response),
      // Marks this as a read of a REFUSAL, not of answers — so a later refusal read may replace it, and a
      // later real analysis is never mistaken for one.
      refusalRead: true,
      ...aboutFromRecipient(assignment.recipient, assignment.senderPersonId),
      at,
    },
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
  };
  await saveInsight(deps.fs, deps.key, insight);
  return { ok: true, insight, usage: call.usage };
}
