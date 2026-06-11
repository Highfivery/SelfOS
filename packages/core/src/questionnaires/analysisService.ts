import { z } from 'zod';
import { uuid } from '../id';
import { listInsightsForPerson, saveInsight } from '../insights';
import type { AnswerValue } from './answering';
import type { Insight, QuestionnaireAnalyzeResult } from '../schemas';
import { ANALYSIS_SYSTEM, buildAnalysisUserMessage } from './aiPrompts';
import { getAssignment, getAssignmentSnapshot } from './assignmentService';
import { runClaude, type AiDeps } from './generationService';
import { getResponse } from './responseService';

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

const AnalysisSchema = z.object({
  summary: z.string().min(1),
  facts: z.array(z.object({ text: z.string().min(1), shareable: z.boolean() })),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  crisisFlag: z.boolean().optional(),
});

/** Pull the first JSON object out of a model reply (tolerates fences / surrounding prose). */
export function extractJsonObject(text: string): unknown {
  const fenced = text.replace(/```json|```/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
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
  if (!assignment || !snapshot || !response) {
    return { ok: false, reason: 'NO_RESPONSE', message: 'There are no answers to analyze yet.' };
  }

  const byId = new Map(snapshot.questions.map((q) => [q.id, q]));
  const qa = response.answers.flatMap((a) => {
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

  const validated = AnalysisSchema.safeParse(extractJsonObject(call.text));
  if (!validated.success) {
    return {
      ok: false,
      reason: 'REFUSED',
      usage: call.usage,
      message: 'Couldn’t analyze those answers.',
    };
  }

  // Metrics from questions that declared a `metricKey` (§4.3) — forward-compatible; empty until
  // metricKey authoring (owned by spec 11) exists, so today this stays {} for normal questionnaires.
  const metrics: Record<string, number> = {};
  for (const a of response.answers) {
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
    approved: false, // requires the approve-step before it feeds buildContext (§3.7)
    provenance: { assignmentId: assignment.id, at },
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    ...(validated.data.crisisFlag ? { crisisFlag: true } : {}),
  };
  await saveInsight(deps.fs, deps.key, insight);
  return { ok: true, insight, usage: call.usage };
}
