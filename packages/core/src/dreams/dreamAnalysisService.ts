import { z } from 'zod';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import { DreamTagsSchema } from '../schemas';
import type {
  ChatTurnResult,
  Conversation,
  DreamAnalysis,
  Insight,
  InsightFact,
  UsageEvent,
} from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { buildContext } from '../people';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { deleteInsight, saveInsight } from '../insights';
import {
  deleteDream,
  getAnalysis,
  getDream,
  getDreamConversation,
  saveAnalysis,
  saveDream,
  saveDreamConversation,
} from './dreamService';

/**
 * Dream guided-analysis service (12-dreams §3.2/§5.1). A dream-scoped reflective chat (reusing `05`'s
 * streaming + `06`'s budgeting/metering, but stored UNDER the dream and metered as `dream.analyze`) that
 * the person can, on their cue, **synthesize** into a structured `DreamAnalysis`, then **approve** into an
 * `Insight` (`source: 'dream'`) that feeds the coach (08 §4.4). The API key never leaves the host.
 */

/** Blended, honest dream-work voice (12 §8.1): evidence-based reflection + symbolic readings as imagination. */
export const DREAM_ANALYSIS_GUIDANCE = `The person is reflecting on a dream. Guide them gently, one \
focused question at a time — explore the dream's feelings, its vivid images, and what it might connect to \
in their waking life (the continuity between dreams and daily concerns), in an exploration → insight → \
action arc. You MAY offer symbolic or archetypal readings of images, but ALWAYS frame them as imaginative \
reflections to consider — never as fixed meanings, facts, science, or diagnosis. Stay warm and curious; \
favour one good question over a wall of interpretation. When the person is ready, they can ask you to \
write up an analysis.`;

const SYNTHESIS_INSTRUCTION = `Now write a structured reflection on this dream. Respond with ONLY a single \
JSON object (no markdown fences, no prose outside it) with these keys:
- "summary": a brief, warm retelling (string)
- "emotionalLandscape": the feelings in the dream and their texture (string)
- "wakingLifeConnections": gentle, tentative links to waking life, framed as possibilities not certainties (string)
- "notableImages": symbolic/archetypal reflections on standout images, explicitly framed as imaginative reflection, not fact (string)
- "reflectiveQuestions": 2-3 open questions for the person (array of strings)
- "coachingPrompt": one gentle suggestion or intention (string)
- "tags": { "emotions": [], "symbols": [], "settings": [], "themes": [], "people": [] } — short lowercase keywords for tracking patterns over time
- "metrics": optional object of normalized signals for trend tracking, e.g. {"emotionalIntensity": 0.0-1.0, "valence": -1.0..1.0} (object)
- "crisisFlag": true ONLY if self-harm, suicide, or acute crisis is disclosed (boolean)
- "distressSignal": true if there are signs of significant trauma or recurring distress worth gently noting (boolean)`;

/** The AI-output contract for synthesis — validated before it's trusted (the host owns ids/timestamps). */
const DreamAnalysisDraftSchema = z.object({
  summary: z.string(),
  emotionalLandscape: z.string(),
  wakingLifeConnections: z.string(),
  notableImages: z.string(),
  reflectiveQuestions: z.array(z.string()),
  coachingPrompt: z.string().optional(),
  tags: DreamTagsSchema, // reuse the canonical tags shape so the validator can't drift
  metrics: z.record(z.string(), z.number()).optional(),
  crisisFlag: z.boolean().optional(),
  distressSignal: z.boolean().optional(),
});

export type DreamSynthesisResult =
  | { ok: true; analysis: DreamAnalysis; usage: UsageEvent }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'NOT_FOUND'; message: string };

export type DreamApproveResult =
  | { ok: true; insightId: string }
  | { ok: false; reason: 'MEMORY_DISABLED' | 'NOT_FOUND'; message: string };

export interface DreamAnalysisTurnDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  dreamId: string;
  userText: string;
  onDelta: (text: string) => void;
  now: Date;
  override?: boolean;
}

export interface DreamSynthesisDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  dreamId: string;
  now: Date;
  override?: boolean;
}

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || 'Dream';
}

/** Assemble the guided-analysis system prompt: coach voice + safety + dream-work guidance + the dream + context. */
async function buildDreamPrompt(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  narrative: string,
): Promise<string> {
  const context = await buildContext(fs, key, personId);
  return [PERSONA, SAFETY, DREAM_ANALYSIS_GUIDANCE, `The dream:\n"${narrative}"`, context]
    .filter(Boolean)
    .join('\n\n');
}

function buildUsage(
  model: string,
  dreamId: string,
  personId: string,
  at: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'dream.analyze',
    personId,
    sessionId: dreamId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

async function overBudget(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
  override: boolean | undefined,
): Promise<boolean> {
  const person = await checkBudget(fs, key, { scope: 'person', personId, now, override });
  const app = await checkBudget(fs, key, { scope: 'app', now, override });
  return person.state === 'over' || app.state === 'over';
}

/**
 * One turn of the guided dream-analysis chat: budget-check, stream the reply, append both messages to the
 * dream's transcript (under the dream, never in Sessions), and meter as `dream.analyze`.
 */
export async function runAnalysisTurn(deps: DreamAnalysisTurnDeps): Promise<ChatTurnResult> {
  const { fs, key, client, apiKey, model, personId, dreamId, userText, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const dream = await getDream(fs, key, personId, dreamId);
  if (!dream)
    return { ok: false, reason: 'ERROR', message: 'That dream could no longer be found.' };

  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();
  const existing = await getDreamConversation(fs, key, personId, dreamId);
  const conversation: Conversation = existing ?? {
    id: dreamId,
    schemaVersion: 1,
    personId,
    title: deriveTitle(dream.title ?? dream.narrative),
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
  conversation.messages.push({ role: 'user', content: userText, ts: at });

  const system = await buildDreamPrompt(fs, key, personId, dream.narrative);
  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system,
        messages: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
        maxTokens: 1024,
      },
      deps.onDelta,
    );
  } catch {
    return { ok: false, reason: 'ERROR', message: 'The coach couldn’t respond. Please try again.' };
  }

  conversation.messages.push({ role: 'assistant', content: result.text, ts: at });
  conversation.updatedAt = at;
  await saveDreamConversation(fs, key, conversation);

  // Mark the dream as in-analysis the first time we talk about it (until a synthesis lands).
  if (dream.status === 'captured') {
    await saveDream(fs, key, { ...dream, status: 'analyzing', updatedAt: at });
  }

  const usage = buildUsage(model, dreamId, personId, at, result.usage);
  await recordUsage(fs, key, usage);
  return { ok: true, conversation, usage };
}

function extractJson(text: string): unknown {
  // Strip markdown code fences first, then brace-match — models sometimes wrap JSON in ```json … ```.
  const stripped = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object in model output');
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Synthesize the dream (+ any guided-chat transcript) into a structured, schema-validated `DreamAnalysis`,
 * persist it, and mark the dream `analyzed`. Re-synthesizing replaces the prior analysis and drops its
 * stale Insight (12 §3.6) — the fresh analysis must be re-approved to feed the coach again.
 */
export async function synthesizeAnalysis(deps: DreamSynthesisDeps): Promise<DreamSynthesisResult> {
  const { fs, key, client, apiKey, model, personId, dreamId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const dream = await getDream(fs, key, personId, dreamId);
  if (!dream)
    return { ok: false, reason: 'NOT_FOUND', message: 'That dream could no longer be found.' };

  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();
  const transcript = await getDreamConversation(fs, key, personId, dreamId);
  const messages = [
    ...(transcript?.messages.map((m) => ({ role: m.role, content: m.content })) ?? []),
    { role: 'user' as const, content: SYNTHESIS_INSTRUCTION },
  ];

  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: await buildDreamPrompt(fs, key, personId, dream.narrative),
        messages,
        maxTokens: 1500,
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The analysis couldn’t be written. Please try again.',
    };
  }

  // Meter the paid call the moment it returns — the tokens were spent even if parsing then fails.
  const usage = buildUsage(model, dreamId, personId, at, result.usage);
  await recordUsage(fs, key, usage);

  let draft;
  try {
    draft = DreamAnalysisDraftSchema.parse(extractJson(result.text));
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The analysis came back in an unexpected shape. Please try again.',
    };
  }

  // Re-synthesis: drop the prior analysis's Insight so a stale reading can't keep feeding the coach.
  const prior = await getAnalysis(fs, key, personId, dreamId);
  if (prior?.insightId) await deleteInsight(fs, personId, prior.insightId);

  const analysis: DreamAnalysis = {
    id: uuid(),
    schemaVersion: 1,
    dreamId,
    personId,
    summary: draft.summary,
    emotionalLandscape: draft.emotionalLandscape,
    wakingLifeConnections: draft.wakingLifeConnections,
    notableImages: draft.notableImages,
    reflectiveQuestions: draft.reflectiveQuestions,
    ...(draft.coachingPrompt !== undefined ? { coachingPrompt: draft.coachingPrompt } : {}),
    tags: draft.tags,
    ...(draft.metrics !== undefined ? { metrics: draft.metrics } : {}),
    lensesApplied: ['reflective', 'continuity', 'symbolic'],
    ...(draft.crisisFlag !== undefined ? { crisisFlag: draft.crisisFlag } : {}),
    ...(draft.distressSignal !== undefined ? { distressSignal: draft.distressSignal } : {}),
    edited: false,
    generatedAt: at,
    updatedAt: at,
  };
  await saveAnalysis(fs, key, analysis);
  await saveDream(fs, key, {
    ...dream,
    status: 'analyzed',
    analysisId: analysis.id,
    updatedAt: at,
  });

  return { ok: true, analysis, usage };
}

/**
 * Approve a dream's analysis into the coach's memory: distill it into an `Insight` (`source: 'dream'`).
 * Gated by `dreams.memoryEnabled` (passed in by the host) — when memory is off, approving is refused
 * (the analysis stays saved + editable; nothing feeds the coach, 12 §3.3).
 */
export async function approveAnalysis(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  dreamId: string;
  memoryEnabled: boolean;
  now: Date;
}): Promise<DreamApproveResult> {
  const { fs, key, personId, dreamId, memoryEnabled, now } = deps;
  if (!memoryEnabled) {
    return {
      ok: false,
      reason: 'MEMORY_DISABLED',
      message: 'Dream memory is turned off in settings.',
    };
  }
  const analysis = await getAnalysis(fs, key, personId, dreamId);
  if (!analysis)
    return { ok: false, reason: 'NOT_FOUND', message: 'There’s no analysis to approve yet.' };

  const at = now.toISOString();
  const facts: InsightFact[] = [];
  if (analysis.wakingLifeConnections.trim()) {
    facts.push({ id: uuid(), text: analysis.wakingLifeConnections, shareable: false });
  }
  if (analysis.emotionalLandscape.trim()) {
    facts.push({ id: uuid(), text: analysis.emotionalLandscape, shareable: false });
  }

  const insightId = analysis.insightId ?? uuid();
  const insight: Insight = {
    id: insightId,
    schemaVersion: 1,
    source: 'dream',
    subjectPersonId: personId,
    summary: analysis.summary,
    facts,
    ...(analysis.metrics !== undefined ? { metrics: analysis.metrics } : {}),
    confidence: 'medium',
    approved: true, // dreams use an explicit approve-step (12 §3.3); this IS that step
    provenance: { dreamId, at },
    ...(analysis.crisisFlag !== undefined ? { crisisFlag: analysis.crisisFlag } : {}),
    createdAt: at,
    updatedAt: at,
  };
  await saveInsight(fs, key, insight);
  await saveAnalysis(fs, key, { ...analysis, insightId, updatedAt: at });
  return { ok: true, insightId };
}

/**
 * Delete a dream **and** its linked Insight (12 §3.6). `dreamService.deleteDream` only purges the dream
 * folder; the approved Insight lives outside it (`people/<id>/insights/`), so deleting the folder alone
 * would orphan an Insight that keeps feeding the coach. Use this (not `deleteDream`) for the delete path.
 */
export async function purgeDream(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  dreamId: string,
): Promise<void> {
  const analysis = await getAnalysis(fs, key, personId, dreamId);
  if (analysis?.insightId) await deleteInsight(fs, personId, analysis.insightId);
  await deleteDream(fs, personId, dreamId);
}

/** Remove a dream's analysis from the coach's memory: delete its Insight + unlink it (12 §3.3). */
export async function removeFromContext(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  dreamId: string;
  now: Date;
}): Promise<void> {
  const { fs, key, personId, dreamId, now } = deps;
  const analysis = await getAnalysis(fs, key, personId, dreamId);
  if (!analysis?.insightId) return;
  await deleteInsight(fs, personId, analysis.insightId);
  const cleared: DreamAnalysis = { ...analysis, updatedAt: now.toISOString() };
  delete cleared.insightId; // unlink — the analysis stays, just no longer feeds the coach
  await saveAnalysis(fs, key, cleared);
}
