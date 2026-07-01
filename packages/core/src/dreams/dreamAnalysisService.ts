import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import { DreamTagsSchema } from '../schemas';
import { dreamTopic } from './dreamTopic';
import type {
  ChatTurnResult,
  Conversation,
  Dream,
  DreamAnalysis,
  DreamAnalysisEdits,
  DreamApproveResult,
  DreamReflectionResult,
  DreamSynthesisResult,
  Insight,
  InsightFact,
  UsageEvent,
} from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { buildContext, buildLinkedPeopleContext, listRelationships } from '../people';
import type { RelationshipType } from '../schemas';
import { FORMATTING, PERSONA, SAFETY } from '../conversations/promptBuilder';
import { deleteInsight, getInsight, saveInsight } from '../insights';
import {
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
export const DREAM_ANALYSIS_GUIDANCE = `You are reflecting on a dream with the person as a warm, insightful \
dream-analysis guide — drawing on established, evidence-informed dream-work approaches: the continuity \
hypothesis (dreams echo waking concerns, relationships, and feelings), imagery and metaphor exploration, \
and — for distressing or recurring dreams — a gentle imagery-rehearsal framing (imagining a different, \
safer version of the dream). You MAY invite Gestalt-style exploration ("if that image could speak, what \
would it say?"; "become the house for a moment — how does it feel?") and offer symbolic or archetypal \
readings, but ALWAYS frame any symbolism as imaginative reflection to consider — never as fixed meaning, \
fact, science, or diagnosis. Guide gently, ONE focused question at a time, following the material the \
person brings — the felt emotions, the images that stood out, and what it might connect to in their waking \
life — in an unhurried exploration → insight → gentle-action arc. Favour one good question over a wall of \
interpretation; stay curious, never clinical. This is reflective self-help, not therapy, diagnosis, or \
treatment. When you have enough to write a meaningful reflection, the person can ask you to write up an \
analysis (and you may gently offer).`;

/** The private "I have enough to write an analysis now" signal (12 §15.4) — mirrors `05`/`09`'s wrap-up
 * marker. Deliberately unlikely to occur in natural prose; never shown to the person. */
export const DREAM_READY_MARKER = '[[SELFOS:DREAM_READY]]';

/** Teaches the coach the readiness-marker convention (appended to dream-analysis chat turns only). */
export const DREAM_READY_INSTRUCTION = `Privately, once you have gathered enough about this dream to write \
a meaningful reflection — the person has shared the feelings, the images that stood out, and any \
waking-life echoes you need — append the exact token ${DREAM_READY_MARKER} as the very last thing in your \
reply, on its own. It is a silent signal to the app that an analysis can now be written; it is never shown \
to the person, so never mention it, explain it, or use it before you genuinely have enough. If you still \
need more from them first, do not include it.`;

/** The (non-persisted) instruction that has the coach OPEN the reflection referencing this specific dream. */
const OPENER_INSTRUCTION = `Open the reflection now. Greet the person warmly and briefly, reflect their \
dream back to them in a sentence or two — mentioning something specific from it — so it's clear you've \
really read it, then ask ONE gentle opening question to begin exploring it together. Do not analyze, \
interpret, list symbols, or summarize the whole dream yet — just warmly begin the conversation.`;

/** A warm, AI-free opener used when the coach can't open the reflection (no key / over budget / error). */
function staticOpener(): string {
  return `Let's take some time with this dream together. What stands out most as you sit with it — a \
feeling, an image, a moment? We'll start there.`;
}

/**
 * Remove the dream-readiness marker (and any trailing partial still mid-stream) from a reply, trimming
 * trailing whitespace. Safe on every streamed delta-accumulation so the token never flashes (12 §15.4).
 * Mirrors `stripWrapUpMarker`.
 */
export function stripDreamMarkers(text: string): string {
  let out = text.split(DREAM_READY_MARKER).join('');
  for (let i = DREAM_READY_MARKER.length - 1; i > 0; i--) {
    const partial = DREAM_READY_MARKER.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}

const SYNTHESIS_INSTRUCTION = `Now write a structured reflection on this dream. The prose fields (summary, \
emotionalLandscape, wakingLifeConnections, notableImages, coachingPrompt) may use light Markdown — \
paragraphs, **bold**, *italic*, "-" lists; no tables, images, raw HTML, or code fences. The \
reflectiveQuestions and tag keywords stay PLAIN. Respond with ONLY a single \
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

const EMPTY_TAGS = { emotions: [], symbols: [], settings: [], themes: [], people: [] };

/**
 * The AI-output contract for synthesis — validated before it's trusted (the host owns ids/timestamps).
 * Tolerant by design (37 §3.1): require only `summary` (the analysis anchor); the other prose fields
 * `.catch('')`, reflectiveQuestions is per-element salvaging, tags fall back to empty, metrics/optionals
 * `.catch`. `crisisFlag`/`distressSignal` are preserved (.catch(undefined), never coerced — §8) so a
 * per-element salvage can't drop a crisis/distress signal.
 */
const DreamAnalysisDraftSchema = z.object({
  summary: z.string().min(1),
  emotionalLandscape: z.string().catch(''),
  wakingLifeConnections: z.string().catch(''),
  notableImages: z.string().catch(''),
  reflectiveQuestions: tolerantArray(z.string(), '', (q) => q.trim() !== ''),
  coachingPrompt: z.string().optional().catch(undefined),
  tags: DreamTagsSchema.catch(EMPTY_TAGS), // reuse the canonical tags shape so the validator can't drift
  metrics: z.record(z.string(), z.number()).optional().catch(undefined),
  crisisFlag: z.boolean().optional().catch(undefined),
  distressSignal: z.boolean().optional().catch(undefined),
});

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
  dream: Dream,
): Promise<string> {
  // The People-graph-linked people who appeared in THIS dream (12 §3.1/§5.1).
  const linkedIds = dream.people
    .map((person) => person.personId)
    .filter((id): id is string => Boolean(id));
  // Resolve each linked figure's relationship to the dreamer so the dream topic can widen by it (28 §13.1):
  // a partner → Intimacy, a parent/sibling → Family, etc. (dreamTopic stays pure — the async lookup is here).
  const relationships = await listRelationships(fs, key);
  const relationshipTypes = linkedIds
    .map(
      (id) =>
        relationships.find(
          (r) =>
            (r.fromPersonId === personId && r.toPersonId === id) ||
            (r.fromPersonId === id && r.toPersonId === personId),
        )?.type,
    )
    .filter((t): t is RelationshipType => t !== undefined);
  // Feed the pinned portrait the dream's life-areas (28 §13.1) so its relevant facts surface in the analysis.
  const context = await buildContext(fs, key, personId, dreamTopic(dream, relationshipTypes));
  // Foreground the linked people (shareable data only — never their private notes) so the coach can connect
  // the dream's figures to real relationships.
  const dreamPeople = await buildLinkedPeopleContext(fs, key, personId, linkedIds);
  return [
    PERSONA,
    SAFETY,
    DREAM_ANALYSIS_GUIDANCE,
    `The dream:\n"${dream.narrative}"`,
    context,
    dreamPeople,
    FORMATTING,
  ]
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

  // Teach the coach the readiness-marker convention on chat turns (never on synthesis), mirroring `05`'s
  // wrap-up instruction — so it can silently signal when it has enough to write an analysis.
  const system = `${await buildDreamPrompt(fs, key, personId, dream)}\n\n${DREAM_READY_INSTRUCTION}`;
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

  // Detect the readiness marker, then strip it (and any mid-stream partial) so it never persists or shows.
  const analysisReady = result.text.includes(DREAM_READY_MARKER);
  conversation.messages.push({
    role: 'assistant',
    content: stripDreamMarkers(result.text),
    ts: at,
  });
  conversation.updatedAt = at;
  await saveDreamConversation(fs, key, conversation);

  // Mark the dream as in-analysis the first time we talk about it (until a synthesis lands).
  if (dream.status === 'captured') {
    await saveDream(fs, key, { ...dream, status: 'analyzing', updatedAt: at });
  }

  const usage = buildUsage(model, dreamId, personId, at, result.usage);
  await recordUsage(fs, key, usage);
  return { ok: true, conversation, usage, ...(analysisReady ? { analysisReady } : {}) };
}

export interface DreamOpenReflectionDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  dreamId: string;
  onDelta: (text: string) => void;
  now: Date;
  override?: boolean;
}

/**
 * Open (or resume) a dream's guided reflection (12 §15.2/§15.4): the coach speaks first with an
 * AI-generated opener that reflects THIS dream back and asks one gentle question — so the session never
 * opens as a blank chat re-asking for the dream. Idempotent: an already-opened reflection (a transcript
 * with messages) is returned as-is with no spend. Metered `dream.analyze`. Degrades gracefully — no key,
 * over budget, or a transport error seeds a warm static opener (still `ok: true`) so the session always
 * opens. The synthetic opener instruction is NEVER persisted (only the coach's reply is), mirroring how
 * `synthesizeAnalysis` sends a non-persisted instruction.
 */
export async function openReflection(
  deps: DreamOpenReflectionDeps,
): Promise<DreamReflectionResult> {
  const { fs, key, client, apiKey, model, personId, dreamId, now } = deps;
  const dream = await getDream(fs, key, personId, dreamId);
  if (!dream)
    return { ok: false, reason: 'ERROR', message: 'That dream could no longer be found.' };

  const at = now.toISOString();
  const existing = await getDreamConversation(fs, key, personId, dreamId);
  // Idempotent — a reflection that's already been opened just resumes (no model call, no spend).
  if (existing && existing.messages.length > 0) return { ok: true, conversation: existing };

  const base: Conversation = existing ?? {
    id: dreamId,
    schemaVersion: 1,
    personId,
    title: deriveTitle(dream.title ?? dream.narrative),
    createdAt: at,
    updatedAt: at,
    messages: [],
  };

  // Persist the opener as the conversation's first (assistant) message + advance the dream to `analyzing`.
  const persist = async (text: string, usage?: UsageEvent): Promise<DreamReflectionResult> => {
    const conversation: Conversation = {
      ...base,
      messages: [{ role: 'assistant', content: text, ts: at }],
      updatedAt: at,
    };
    await saveDreamConversation(fs, key, conversation);
    if (dream.status === 'captured') {
      await saveDream(fs, key, { ...dream, status: 'analyzing', updatedAt: at });
    }
    return { ok: true, conversation, ...(usage ? { usage } : {}) };
  };

  // No key or over budget → open gracefully with a warm static opener (no spend).
  if (!apiKey) return persist(staticOpener());
  if (await overBudget(fs, key, personId, now, deps.override)) return persist(staticOpener());

  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: await buildDreamPrompt(fs, key, personId, dream),
        messages: [{ role: 'user', content: OPENER_INSTRUCTION }],
        maxTokens: 512,
      },
      deps.onDelta,
    );
  } catch {
    return persist(staticOpener()); // transport error → still open, statically
  }

  const usage = buildUsage(model, dreamId, personId, at, result.usage);
  await recordUsage(fs, key, usage);
  // The opener shouldn't carry the readiness marker, but strip defensively; empty reply → static opener.
  const text = stripDreamMarkers(result.text).trim() || staticOpener();
  return persist(text, usage);
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
        system: await buildDreamPrompt(fs, key, personId, dream),
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

  // Tolerant parse; only a genuinely-empty/no-JSON reply (no salvageable `summary`) fails, classified into
  // distinct honest reasons (TRUNCATED cut-off vs MALFORMED unexpected-shape vs REFUSED) — 37 §3.2.
  const draft = DreamAnalysisDraftSchema.safeParse(extractJsonObject(result.text)).data;
  if (!draft) {
    const { reason, message } = classifyParseOutcome(result.text, 'analysis');
    return { ok: false, reason, message, usage };
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
 * Save the person's edits to a dream's analysis (12 §3.2/§3.3) — overwriting only the supplied readable
 * sections, marking it `edited`. The AI-owned structured tags/metrics/flags and the `insightId` link are
 * preserved; null if there's no analysis yet. Re-approving after an edit refreshes the linked Insight.
 */
export async function updateAnalysis(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  dreamId: string;
  edits: DreamAnalysisEdits;
  now: Date;
}): Promise<DreamAnalysis | null> {
  const { fs, key, personId, dreamId, edits, now } = deps;
  const analysis = await getAnalysis(fs, key, personId, dreamId);
  if (!analysis) return null;
  const updated: DreamAnalysis = {
    ...analysis,
    ...(edits.summary !== undefined ? { summary: edits.summary } : {}),
    ...(edits.emotionalLandscape !== undefined
      ? { emotionalLandscape: edits.emotionalLandscape }
      : {}),
    ...(edits.wakingLifeConnections !== undefined
      ? { wakingLifeConnections: edits.wakingLifeConnections }
      : {}),
    ...(edits.notableImages !== undefined ? { notableImages: edits.notableImages } : {}),
    ...(edits.reflectiveQuestions !== undefined
      ? { reflectiveQuestions: edits.reflectiveQuestions }
      : {}),
    ...(edits.coachingPrompt !== undefined ? { coachingPrompt: edits.coachingPrompt } : {}),
    edited: true,
    updatedAt: now.toISOString(),
  };
  await saveAnalysis(fs, key, updated);
  return updated;
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
  const insightId = analysis.insightId ?? uuid();

  // Re-approving an edited analysis must KEEP who each fact was shared with (12 §3.4) — so facts use a
  // stable per-field id and carry their prior `shareableWith` forward (re-wording a section keeps its
  // shares). A fresh approval (no prior insight) starts unshared.
  const prior = analysis.insightId ? await getInsight(fs, key, personId, insightId) : null;
  const priorShares = new Map((prior?.facts ?? []).map((fact) => [fact.id, fact.shareableWith]));
  const facts: InsightFact[] = [];
  const addFact = (suffix: string, text: string): void => {
    if (!text.trim()) return;
    const id = `${insightId}:${suffix}`;
    const carried = priorShares.get(id);
    facts.push({
      id,
      text,
      shareable: false,
      ...(carried && carried.length > 0 ? { shareableWith: carried } : {}),
    });
  };
  addFact('waking', analysis.wakingLifeConnections);
  addFact('emotional', analysis.emotionalLandscape);

  const insight: Insight = {
    id: insightId,
    schemaVersion: 1,
    source: 'dream',
    subjectPersonId: personId,
    summary: analysis.summary,
    facts,
    ...(analysis.metrics !== undefined ? { metrics: analysis.metrics } : {}),
    confidence: 'medium',
    // A dream is approved separately from synthesis, so its life-area isn't folded into an analysis call;
    // default to the emotion/pattern area (dreams are emotion-centric) and let the manual "Refresh memory"
    // AI-retag outliers (20-memory-dashboard §3.5).
    categories: ['Emotions & patterns'],
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
