import { z } from 'zod';
import { classifyParseOutcome, salvageJsonObjectField, tolerantArray } from '../ai/jsonSalvage';
import type { FileSystem } from '../host';
import { uuid } from '../id';
import { listInsightsForPerson, saveInsight } from '../insights';
import { getPerson } from '../people/peopleService';
import {
  AlignmentReportSchema,
  type AlignmentItem,
  type AlignmentReport,
  type AlignmentResult,
  type Assignment,
  type ContextOnlyResult,
  type Insight,
  type Questionnaire,
  type ResponseSet,
  type UsageEvent,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import {
  ALIGNMENT_SYSTEM,
  ANALYSIS_SYSTEM,
  buildAlignmentUserMessage,
  buildAnalysisUserMessage,
} from './aiPrompts';
import { extractJsonObject } from './analysisService';
import { formatAnswerForDisplay } from './answering';
import { getAssignmentSnapshot, listAssignments } from './assignmentService';
import { alignmentReportPath, compatDir } from './paths';
import { runClaude, type AiDeps } from './generationService';
import { getResponse } from './responseService';

/**
 * Compatibility alignment (08-questionnaires §3.6/§13.5d). Once both answerers of a compatibility send
 * have submitted, the sender can generate an **alignment report** — the two responses aligned by
 * `canonicalId`, compared into a warm, honest report **and** a draft Insight (subject = the sender) the
 * sender reviews in Memory. Budget-gated + metered like the rest of the AI surface; the report is stored
 * encrypted under the group folder, never the raw answers.
 */

// Tolerant by design (37 §3.1): require only `summary`; per-question verdicts (`items`) and `facts` are
// per-element salvaging — a bad verdict/fact drops, the rest survive, and an un-verdicted prompt simply
// defaults to `mixed` downstream (the report is partial-safe). `crisisFlag` is preserved, never coerced (§8).
const ALIGN_ITEM_SENTINEL = { canonicalId: '', agreement: 'mixed' as const, note: '' };
const ALIGN_FACT_SENTINEL = { text: '', shareable: false };
const AlignmentAiSchema = z.object({
  summary: z.string().min(1),
  items: tolerantArray(
    z.object({
      canonicalId: z.string(),
      agreement: z.enum(['aligned', 'mixed', 'divergent']),
      note: z.string(),
    }),
    ALIGN_ITEM_SENTINEL,
    (i) => i.canonicalId.trim() !== '',
  ),
  crisisFlag: z.boolean().optional().catch(undefined),
  facts: tolerantArray(
    z.object({ text: z.string().min(1), shareable: z.boolean() }),
    ALIGN_FACT_SENTINEL,
    (f) => f.text.trim() !== '',
  ),
});

/** Read a group's stored alignment report; null if not generated yet. */
export async function getAlignmentReport(
  fs: FileSystem,
  key: Uint8Array,
  compatibilityGroupId: string,
): Promise<AlignmentReport | null> {
  const raw = await readEncryptedJson(fs, alignmentReportPath(compatibilityGroupId), key);
  return raw ? AlignmentReportSchema.parse(raw) : null;
}

/** The (≤2) assignments that make up one compatibility group, newest first. */
export async function getCompatibilityGroup(
  fs: FileSystem,
  key: Uint8Array,
  compatibilityGroupId: string,
): Promise<Awaited<ReturnType<typeof listAssignments>>> {
  return (await listAssignments(fs, key)).filter(
    (a) => a.compatibilityGroupId === compatibilityGroupId,
  );
}

/** A participant's display name — a household person's profile name, or an external recipient's given name. */
const participantName = async (fs: FileSystem, key: Uint8Array, a: Assignment): Promise<string> =>
  a.recipient.kind === 'person'
    ? ((await getPerson(fs, key, a.recipient.personId))?.displayName ?? 'Unknown')
    : (a.recipient.displayName ?? 'them');

/**
 * Generate (or regenerate) a compatibility group's alignment report. Requires both members submitted;
 * aligns their answers by `canonicalId`, produces the report + a draft Insight for the sender, and caches
 * the report. Handles both household pairs and an EXTERNAL participant (who answers via the relay, §17.12-B).
 * The sender must own the group (enforced in the bridge before calling).
 */
export async function generateAlignment(
  deps: AiDeps,
  input: { compatibilityGroupId: string },
): Promise<AlignmentResult> {
  const group = await getCompatibilityGroup(deps.fs, deps.key, input.compatibilityGroupId);
  if (group.length < 2) {
    return { ok: false, reason: 'NOT_READY', message: 'This compatibility send is incomplete.' };
  }
  const [first, second] = group;
  if (!first || !second) {
    return { ok: false, reason: 'NOT_READY', message: 'This compatibility send is incomplete.' };
  }

  const aSnap = await getAssignmentSnapshot(deps.fs, deps.key, first.id);
  const bSnap = await getAssignmentSnapshot(deps.fs, deps.key, second.id);
  const aResp = await getResponse(deps.fs, deps.key, first.id);
  const bResp = await getResponse(deps.fs, deps.key, second.id);
  if (!aSnap || !bSnap || aResp?.submittedAt === undefined || bResp?.submittedAt === undefined) {
    return {
      ok: false,
      reason: 'NOT_READY',
      message: 'Both people need to answer before you can align their responses.',
    };
  }

  const personAName = await participantName(deps.fs, deps.key, first);
  const personBName = await participantName(deps.fs, deps.key, second);

  // Align the two answer sets by canonicalId (falling back to question id). Only questions present in
  // both variants can be compared, so a missing one is simply skipped.
  const aByCanon = new Map(aSnap.questions.map((q) => [q.canonicalId ?? q.id, q]));
  const bByCanon = new Map(bSnap.questions.map((q) => [q.canonicalId ?? q.id, q]));
  const aAnswer = new Map(aResp.answers.map((x) => [x.questionId, x.value]));
  const bAnswer = new Map(bResp.answers.map((x) => [x.questionId, x.value]));

  const aligned: { canonicalId: string; prompt: string; a: string; b: string }[] = [];
  for (const [canonicalId, aq] of aByCanon) {
    const bq = bByCanon.get(canonicalId);
    if (!bq) continue;
    aligned.push({
      canonicalId,
      prompt: aq.prompt,
      a: formatAnswerForDisplay(aq, aAnswer.get(aq.id)),
      b: formatAnswerForDisplay(bq, bAnswer.get(bq.id)),
    });
  }
  if (aligned.length === 0) {
    return {
      ok: false,
      reason: 'NOT_READY',
      message: 'These two responses don’t line up — nothing to compare.',
    };
  }

  const call = await runClaude(
    deps,
    ALIGNMENT_SYSTEM,
    buildAlignmentUserMessage({ title: aSnap.title, personAName, personBName, items: aligned }),
    'questionnaire.analyze',
    1200,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // Tolerant parse; on a truncated object salvage the leading `summary` (the report is still useful — every
  // aligned prompt defaults to `mixed`). Only a genuinely-empty/no-JSON reply is classified honestly.
  let aiData = AlignmentAiSchema.safeParse(extractJsonObject(call.text)).data;
  if (!aiData) {
    const summary = salvageJsonObjectField(call.text, 'summary');
    if (summary?.trim()) aiData = { summary, items: [], facts: [] };
  }
  if (!aiData) {
    const { reason, message } = classifyParseOutcome(call.text, 'comparison');
    return { ok: false, reason, usage: call.usage, message };
  }
  const validated = { data: aiData } as const;

  // Merge the model's per-question verdicts back onto our aligned prompts (the canonicalId is the join).
  const verdictByCanon = new Map(validated.data.items.map((i) => [i.canonicalId, i]));
  const items: AlignmentItem[] = aligned.map((x) => {
    const verdict = verdictByCanon.get(x.canonicalId);
    return {
      canonicalId: x.canonicalId,
      prompt: x.prompt,
      agreement: verdict?.agreement ?? 'mixed',
      note: verdict?.note ?? '',
    };
  });

  // Draft (or refresh) the sender's Insight from this report — dedup by the compatibility group so a
  // regenerate overwrites rather than duplicating, and resets it to unapproved for re-review.
  const at = deps.now.toISOString();
  const prior = (await listInsightsForPerson(deps.fs, deps.key, deps.personId)).find(
    (i) => i.provenance.compatibilityGroupId === input.compatibilityGroupId,
  );
  const insight: Insight = {
    id: prior?.id ?? uuid(),
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: deps.personId,
    summary: validated.data.summary,
    facts: validated.data.facts.map((f) => ({ id: uuid(), text: f.text, shareable: f.shareable })),
    confidence: 'medium',
    categories: ['Relationships'], // a compatibility report is inherently relational (20-memory §3.1)
    approved: false,
    provenance: { compatibilityGroupId: input.compatibilityGroupId, at },
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
    ...(validated.data.crisisFlag ? { crisisFlag: true } : {}),
  };
  await saveInsight(deps.fs, deps.key, insight);

  const report: AlignmentReport = {
    schemaVersion: 1,
    compatibilityGroupId: input.compatibilityGroupId,
    questionnaireId: first.questionnaireId,
    personAName,
    personBName,
    summary: validated.data.summary,
    items,
    insightId: insight.id,
    generatedAt: at,
    ...(validated.data.crisisFlag ? { crisisFlag: true } : {}),
  };
  await writeEncryptedJson(
    deps.fs,
    alignmentReportPath(input.compatibilityGroupId),
    report,
    deps.key,
  );
  return { ok: true, report, usage: call.usage };
}

// Tolerant by design (37 §3.1): require only `summary`; per-fact salvage; `crisisFlag` preserved (§8).
const DISTILL_FACT_SENTINEL = { text: '' };
const ContextOnlyDistillSchema = z.object({
  summary: z.string().min(1),
  facts: tolerantArray(
    z.object({ text: z.string().min(1) }),
    DISTILL_FACT_SENTINEL,
    (f) => f.text.trim() !== '',
  ),
  confidence: z.enum(['low', 'medium', 'high']).optional().catch(undefined),
  crisisFlag: z.boolean().optional().catch(undefined),
});

/**
 * Context-only distillation (08-questionnaires §16.2): for a `contextOnly` group, distill **each
 * participant's own answers** into an own-context Insight (subject = that participant) that **auto-approves**
 * into their own coaching context. No report, no cross-person sharing — one participant's raw answers are
 * never read into the other's Insight (each is distilled from their own response alone), and every fact is
 * own-context-only (`shareable: false`). The triggering sender pays + must own the group (enforced in the
 * bridge). Re-running reuses each participant's Insight (dedup by group + subject).
 */
export async function distillContextOnly(
  deps: AiDeps,
  input: { compatibilityGroupId: string },
): Promise<ContextOnlyResult> {
  const group = await getCompatibilityGroup(deps.fs, deps.key, input.compatibilityGroupId);
  const notReady = {
    ok: false as const,
    reason: 'NOT_READY' as const,
    message: 'Both people need to answer before their coaches can use this.',
  };
  if (group.length < 2) return notReady;

  // Pre-validate EVERY member up front — like `generateAlignment` — so a half-answered group returns
  // NOT_READY before any billed Claude call or saved Insight (no partial spend, no half-written state).
  const ready: { subjectPersonId: string; snapshot: Questionnaire; response: ResponseSet }[] = [];
  for (const member of group) {
    if (member.recipient.kind !== 'person') return notReady;
    const snapshot = await getAssignmentSnapshot(deps.fs, deps.key, member.id);
    const response = await getResponse(deps.fs, deps.key, member.id);
    if (!snapshot || !response || response.submittedAt === undefined) return notReady;
    ready.push({ subjectPersonId: member.recipient.personId, snapshot, response });
  }

  const usages: UsageEvent[] = [];
  for (const { subjectPersonId, snapshot, response } of ready) {
    // Distill from THIS participant's own answers only — never the other's (no cross-exposure).
    const byId = new Map(snapshot.questions.map((q) => [q.id, q]));
    const qa = response.answers.flatMap((a) => {
      const q = byId.get(a.questionId);
      return q ? [{ prompt: q.prompt, answer: formatAnswerForDisplay(q, a.value) }] : [];
    });

    const call = await runClaude(
      deps,
      ANALYSIS_SYSTEM,
      buildAnalysisUserMessage({ title: snapshot.title, qa }),
      'questionnaire.analyze',
      800,
    );
    if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

    let distill = ContextOnlyDistillSchema.safeParse(extractJsonObject(call.text)).data;
    if (!distill) {
      const summary = salvageJsonObjectField(call.text, 'summary');
      if (summary?.trim()) distill = { summary, facts: [] };
    }
    if (!distill) {
      const { reason, message } = classifyParseOutcome(call.text, 'summary');
      return { ok: false, reason, message };
    }
    const validated = { data: distill } as const;
    usages.push(call.usage);

    const at = deps.now.toISOString();
    const prior = (await listInsightsForPerson(deps.fs, deps.key, subjectPersonId)).find(
      (i) => i.provenance.compatibilityGroupId === input.compatibilityGroupId,
    );
    const insight: Insight = {
      id: prior?.id ?? uuid(),
      schemaVersion: 1,
      source: 'questionnaire',
      subjectPersonId, // the participant's OWN coaching context (§16.2)
      summary: validated.data.summary,
      // Own-context-only: never cross-shared with another person (§15/§16.2).
      facts: validated.data.facts.map((f) => ({ id: uuid(), text: f.text, shareable: false })),
      confidence: validated.data.confidence ?? 'medium',
      categories: ['Relationships'], // a compatibility insight is inherently relational (20-memory §3.1)
      approved: true, // auto-approved: the participant's own data feeds their own context (decision §16.2)
      provenance: { compatibilityGroupId: input.compatibilityGroupId, at },
      createdAt: prior?.createdAt ?? at,
      updatedAt: at,
      ...(validated.data.crisisFlag ? { crisisFlag: true } : {}),
    };
    await saveInsight(deps.fs, deps.key, insight);
  }

  return { ok: true, updated: ready.length, usage: usages };
}

/**
 * Remove a compatibility group's joint report folder on delete/purge (08-questionnaires §3.9). The drafted
 * Insights (the sender's report insight + any per-participant context insights) are deliberately KEPT
 * (20-memory-dashboard §3.7) — an insight is the coach's lasting memory and persists when its source is
 * deleted; only the joint report artifact is torn down here.
 */
export async function deleteCompatibilityReport(
  fs: FileSystem,
  _key: Uint8Array,
  compatibilityGroupId: string,
): Promise<void> {
  await fs.remove(compatDir(compatibilityGroupId));
}
