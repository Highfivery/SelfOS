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
import { streamWithContinuation } from '../conversations/streamWithContinuation';
import {
  regenerateIndexFor,
  truncateMessages,
  type MessageStamp,
} from '../conversations/rewindService';
import { extractGoals } from '../goals/goalService';
import { mintDreamQuestionnaires } from './dreamQuestionnaireService';
import type { RewindResult } from '../schemas';
import { deleteInsight, getInsight, producedFactShare, saveInsight } from '../insights';
import {
  getAnalysis,
  getDream,
  getDreamConversation,
  patchDream,
  saveAnalysis,
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
treatment.

You NEVER write the analysis yourself in this conversation. The written analysis is a separate thing the \
app produces and saves to their dream journal — so never write out a summary, an interpretation, a list of \
symbols, or anything that reads as "the analysis". Stay in the exploring register: one question at a time.

When you have explored enough — they have shared the feelings, the images that stood out, and any \
waking-life echoes you need — do not keep going. In one short sentence, tell them it feels like there is \
enough here and invite them to create their analysis, and make clear they can keep talking if there is \
more they want to bring. Then let them choose. If they say there is more, keep exploring and do not ask \
again for a while. If they ask you directly to analyze the dream, do not write it out — warmly point them \
to creating the analysis instead.`;

/**
 * Token ceilings for the dream chat (66 §5.2). Adaptive thinking SHARES `maxTokens` with the visible
 * reply ([[adaptive-thinking-shares-maxtokens]]), so the old 1024/512 routinely starved a reflective
 * reply into a truncated or empty one. Ceilings, not targets — only generated tokens are billed.
 */
const DREAM_CHAT_MAX_TOKENS = 4096;
const DREAM_OPENER_MAX_TOKENS = 1024;

/** The private "I have enough to write an analysis now" signal (12 §15.4) — mirrors `05`/`09`'s wrap-up
 * marker. Deliberately unlikely to occur in natural prose; never shown to the person. */
export const DREAM_READY_MARKER = '[[SELFOS:DREAM_READY]]';

/** Teaches the coach the readiness-marker convention (appended to dream-analysis chat turns only). */
export const DREAM_READY_INSTRUCTION = `On the SAME turn that you invite them to create their analysis, \
append the exact token ${DREAM_READY_MARKER} as the very last thing in your reply, on its own. Pair the \
two: the spoken invitation and this token always go together, so the app's offer matches what you just \
said. It is a silent signal that an analysis can now be written; it is never shown to the person, so never \
mention it, explain it, or use it before you genuinely have enough. If they still have more they want to \
explore, keep exploring and do not include it yet.`;

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
- "distressSignal": true if there are signs of significant trauma or recurring distress worth gently noting (boolean)
- "goals": commitments the person ACTUALLY VOICED in the conversation — their words, not your inference. \
Never invent one from dream imagery alone. Omit the key entirely if they named none. (array of strings)
- "questionnaires": AT MOST ONE, and only when the dream points at something genuinely worth asking a \
specific person about. Each is { "title": short title, "brief": one sentence on what to explore, "for": \
either "me" or the NAME of someone who appeared in the dream }. Omit the key entirely otherwise. (array)`;

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
  // 66 §3.4 — both tolerant: a malformed goal or proposal drops itself, never the whole analysis.
  goals: tolerantArray(z.string(), '', (g) => g.trim() !== ''),
  questionnaires: tolerantArray(
    z.object({
      title: z.string().min(1),
      brief: z.string().min(1),
      // "me" or a display NAME. Deliberately never a personId — the model must not be able to address a
      // recipient directly; the host resolves the name against the dream's own people.
      for: z.string().optional().catch(undefined),
    }),
    // The drop sentinel: a malformed proposal collapses to an empty title and is filtered out.
    { title: '', brief: '' },
    (q) => q.title.trim() !== '' && q.brief.trim() !== '',
  ),
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
  /**
   * Whether this person may create questionnaires (66 §3.4). `dreams:synthesize` gates on `dreams.own`,
   * but auto-sending needs `questionnaires.create` — so the bridge resolves it and passes it in, the same
   * way `memoryEnabled` reaches `approveAnalysis`. False ⇒ no minting; the analysis still succeeds.
   */
  questionnairesEnabled?: boolean;
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
  const { fs, key, apiKey, personId, dreamId, userText, now } = deps;
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
  // 66 §3.2 — persist the person's message BEFORE the model call. Previously the transcript was saved
  // only after a successful reply, so a failed turn lost what they'd typed (the store showed it
  // optimistically and never rolled back, so it silently vanished on reload). Saving first leaves the
  // transcript ending on their message, which is the state `retryDreamReply` recovers from.
  conversation.messages.push({ role: 'user', content: userText, ts: at });
  conversation.updatedAt = at;
  await saveDreamConversation(fs, key, conversation);

  // Mark the dream as in-analysis the first time we talk about it (until a synthesis lands).
  // `patchDream` (not a `{...dream}` write): `dream` was read before the model call, so writing it whole
  // would revert anything saved meanwhile — e.g. an image generated during this turn (12 §5.1).
  if (dream.status === 'captured') {
    await patchDream(fs, key, personId, dreamId, { status: 'analyzing', updatedAt: at });
  }

  return generateDreamReply(deps, conversation, dream);
}

/**
 * Stream the coach's reply for a dream transcript that already ends with the person's message. Shared by
 * `runAnalysisTurn` (after it persists that message) and `retryDreamReply` (which re-runs on the existing
 * transcript). A blank reply is an honest EMPTY failure that is never persisted (66 §3.2).
 */
async function generateDreamReply(
  deps: Omit<DreamAnalysisTurnDeps, 'userText'>,
  conversation: Conversation,
  dream: Dream,
): Promise<ChatTurnResult> {
  const { fs, key, client, apiKey, model, personId, dreamId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const at = now.toISOString();

  // Teach the coach the readiness-marker convention on chat turns (never on synthesis), mirroring `05`'s
  // wrap-up instruction — so it can silently signal when it has enough to write an analysis.
  const system = `${await buildDreamPrompt(fs, key, personId, dream)}\n\n${DREAM_READY_INSTRUCTION}`;
  let result;
  try {
    result = await streamWithContinuation(
      client,
      {
        apiKey,
        model,
        system,
        messages: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
        // 66 §5.2 — was 1024. Adaptive thinking SHARES this budget, so a reflective reply was routinely
        // starved to a truncated or empty one (the reported cut-offs). Matches Sessions' ceiling; you only
        // pay for tokens actually generated.
        maxTokens: DREAM_CHAT_MAX_TOKENS,
      },
      deps.onDelta,
      {
        canContinue: async () => !(await overBudget(fs, key, personId, now, deps.override)),
      },
    );
  } catch {
    return { ok: false, reason: 'ERROR', message: 'The coach couldn’t respond. Please try again.' };
  }

  // Meter the billed call FIRST (even a blank reply consumed input + thinking tokens), then decide.
  const usage = buildUsage(model, dreamId, personId, at, result.usage);
  await recordUsage(fs, key, usage);

  // 66 §3.2 — a blank reply is a FAILURE, not a silently-saved empty bubble (the 05 §4.1 rule, which the
  // dream surface never had). The person's message is already on disk, so Try again can recover the turn.
  if (result.text.trim() === '') {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'The coach’s reply came back empty — please try again.',
    };
  }

  // Detect the readiness marker, then strip it (and any mid-stream partial) so it never persists or shows.
  // Both run on the STITCHED text, so a marker split across a continuation seam still resolves (66 §5.1).
  const analysisReady = result.text.includes(DREAM_READY_MARKER);
  // 66 §3.4 — persist the signal the first time it fires, so the offer survives navigating away and back
  // (it used to live only in renderer state and was lost on remount).
  if (analysisReady && !dream.analysisReadyAt) {
    await saveDream(fs, key, { ...dream, analysisReadyAt: at, updatedAt: at });
  }
  conversation.messages.push({
    role: 'assistant',
    content: stripDreamMarkers(result.text),
    ts: at,
  });
  conversation.updatedAt = at;
  await saveDreamConversation(fs, key, conversation);

  return { ok: true, conversation, usage, ...(analysisReady ? { analysisReady } : {}) };
}

/**
 * Truncate a dream transcript at `index` and persist it (66 §3.3). The dream chat reuses the `Conversation`
 * shape, so it reuses the same pure truncate + staleness check as Sessions.
 */
export async function rewindDreamConversation(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  dreamId: string,
  index: number,
  expect: MessageStamp,
): Promise<RewindResult> {
  const conversation = await getDreamConversation(fs, key, personId, dreamId);
  if (!conversation) return { ok: false, reason: 'NOT_FOUND' };

  const result = truncateMessages(conversation.messages, index, expect);
  if (!result.ok) return result;

  // Dream chat messages carry no attachments today, so there is nothing to reap — but the shape is the
  // same, so if that changes the reap belongs here alongside the Sessions one.
  const trimmed: Conversation = {
    ...conversation,
    messages: result.messages,
    updatedAt: new Date().toISOString(),
  };
  await saveDreamConversation(fs, key, trimmed);
  return { ok: true, conversation: trimmed };
}

/** Deps for `retryDreamReply` — a dream turn minus the (already-persisted) user text. */
export type DreamRetryDeps = Omit<DreamAnalysisTurnDeps, 'userText'>;

/**
 * "Retry from here" for a dream reflection (66 §3.3) — rewind to the message, then re-generate. Same
 * shape as the Sessions one: validate the caller's stamp BEFORE writing anything, truncate so the
 * transcript ends on the person's message, then let the existing retry answer it.
 */
export async function regenerateDreamFrom(
  deps: DreamRetryDeps,
  index: number,
  expect: MessageStamp,
): Promise<ChatTurnResult> {
  const { fs, key, personId, dreamId } = deps;
  const conversation = await getDreamConversation(fs, key, personId, dreamId);
  if (!conversation)
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };

  const target = conversation.messages[index];
  if (!target || target.role !== expect.role || target.ts !== expect.ts) {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'This reflection moved on — reopen it and try again.',
    };
  }

  const at = regenerateIndexFor(conversation.messages, index);
  if (at < conversation.messages.length) {
    const cut = conversation.messages[at];
    if (!cut) return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
    const rewound = await rewindDreamConversation(fs, key, personId, dreamId, at, {
      role: cut.role,
      ts: cut.ts,
    });
    if (!rewound.ok)
      return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  }
  return retryDreamReply(deps);
}

/**
 * Re-generate the coach's reply for a dream transcript that ends on an unanswered message (66 §3.2) —
 * after a failed/empty turn, or on reopening a reflection left mid-turn. Adds NO new user message, so it
 * can never duplicate one. Budget-gated + metered like a normal turn.
 */
export async function retryDreamReply(deps: DreamRetryDeps): Promise<ChatTurnResult> {
  const { fs, key, personId, dreamId, now } = deps;
  if (!deps.apiKey)
    return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }
  const dream = await getDream(fs, key, personId, dreamId);
  if (!dream)
    return { ok: false, reason: 'ERROR', message: 'That dream could no longer be found.' };

  const conversation = await getDreamConversation(fs, key, personId, dreamId);
  if (!conversation)
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };

  // Drop any trailing blank assistant ghost first (pre-66 code could persist one), so the transcript
  // ends on the person's message and can be answered.
  while (conversation.messages.length > 0) {
    const tail = conversation.messages[conversation.messages.length - 1];
    if (tail && tail.role === 'assistant' && tail.content.trim() === '')
      conversation.messages.pop();
    else break;
  }
  if (conversation.messages[conversation.messages.length - 1]?.role !== 'user') {
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  }

  return generateDreamReply(deps, conversation, dream);
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
      await patchDream(fs, key, personId, dreamId, { status: 'analyzing', updatedAt: at });
    }
    return { ok: true, conversation, ...(usage ? { usage } : {}) };
  };

  // No key or over budget → open gracefully with a warm static opener (no spend).
  if (!apiKey) return persist(staticOpener());
  if (await overBudget(fs, key, personId, now, deps.override)) return persist(staticOpener());

  let result;
  try {
    result = await streamWithContinuation(
      client,
      {
        apiKey,
        model,
        system: await buildDreamPrompt(fs, key, personId, dream),
        messages: [{ role: 'user', content: OPENER_INSTRUCTION }],
        // 66 §5.2 — was 512. The opener is short, but adaptive thinking shares the budget, so 512 could
        // starve even a two-sentence greeting into a truncated one.
        maxTokens: DREAM_OPENER_MAX_TOKENS,
      },
      deps.onDelta,
      {
        canContinue: async () => !(await overBudget(fs, key, personId, now, deps.override)),
      },
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
        // A bounded structured-JSON call: disable adaptive thinking (it shares `maxTokens` with the
        // visible output — left on, it starves the JSON and it comes back truncated → the "cut off"
        // error). Give the 5 prose sections + tags generous headroom (you only pay for tokens generated).
        // See the intake portrait precedent + [[adaptive-thinking-shares-maxtokens]].
        maxTokens: 4000,
        extendedThinking: false,
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

  // 66 §3.4 — the artifacts this analysis produces. Both are wrapped: they're a bonus, the reflection is
  // the product, so a failure here must never cost the person their analysis.
  try {
    if (draft.goals.length > 0) {
      // The origin `at` is deliberately the FIRST analysis's timestamp, not now: `extractGoals` de-dups by
      // provenance, so a moving timestamp would fold the same dream in again on every re-synthesis and grow
      // `contributingSources` without bound. Stable identity = "this dream, first analyzed at T".
      const touched = await extractGoals({
        fs,
        key,
        personId,
        goals: draft.goals,
        provenance: { dreamId, at: prior?.generatedAt ?? at },
        lifeArea: 'Emotions & patterns',
        now,
      });
      // Note: NO `insightId`. Synthesis runs before approval, and re-synthesis deletes the prior Insight —
      // linking one here would leave a dangling reference.
      if (touched.length > 0) {
        analysis.goals = draft.goals;
        analysis.goalIds = touched.map((g) => g.id);
      }
    }
  } catch {
    // A goal-write failure leaves `goals`/`goalIds` unset; the analysis still saves.
  }

  try {
    if (deps.questionnairesEnabled && draft.questionnaires.length > 0) {
      const sent = await mintDreamQuestionnaires({
        deps,
        fs,
        key,
        personId,
        dream,
        analysisId: analysis.id,
        proposals: draft.questionnaires,
        now,
      });
      if (sent.length > 0) analysis.questionnaires = sent;
    }
  } catch {
    // Same: nothing is persisted by a failed mint, and the analysis is unaffected.
  }

  await saveAnalysis(fs, key, analysis);
  // `patchDream`, NOT `{...dream}`: `dream` was read before the synthesis call, so spreading it here
  // reverts every field written during it — which is exactly how an image generated mid-synthesis got
  // its descriptor wiped and its encrypted bytes orphaned (the 12 §5.1 bug, via a second writer).
  await patchDream(fs, key, personId, dreamId, {
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

  // Re-approving an edited analysis must KEEP each fact's sharing (12 §3.4) — so facts use a stable
  // per-field id and carry their prior `shareableWith` AND explicit `shareableTypes` forward (re-wording a
  // section keeps its shares, and a re-approve never reverts an un-share). A fresh approval defaults to
  // shared-with-partner (owner decision — see producedFactShare).
  const prior = analysis.insightId ? await getInsight(fs, key, personId, insightId) : null;
  const priorShares = new Map((prior?.facts ?? []).map((fact) => [fact.id, fact]));
  const facts: InsightFact[] = [];
  const addFact = (suffix: string, text: string): void => {
    if (!text.trim()) return;
    const id = `${insightId}:${suffix}`;
    const carried = priorShares.get(id);
    facts.push({
      id,
      text,
      ...producedFactShare(undefined, carried?.shareableTypes),
      ...(carried?.shareableWith?.length ? { shareableWith: carried.shareableWith } : {}),
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
