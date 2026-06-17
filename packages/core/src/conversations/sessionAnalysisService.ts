import { z } from 'zod';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import {
  LIFE_AREAS,
  RawProfileSuggestionSchema,
  type Conversation,
  type Insight,
  type InsightFact,
  type SessionStatus,
  type SessionSummaryResult,
  type UsageEvent,
} from '../schemas';
import { buildContext } from '../people';
import { checkBudget, costOf, recordUsage } from '../usage';
import { getInsight, normalizeCategories, saveInsight } from '../insights';
import { recordSuggestionsFromAnalysis } from '../profile';
import { getConversation, saveConversation } from './conversationService';
import { PERSONA, SAFETY } from './promptBuilder';
import { getExercise } from './guidedCatalog';

/**
 * Session-analysis service (09-session-analysis §5). When a coaching session is completed, AI reads the
 * full transcript **once** and distills it into a `SessionInsight` (`source: 'session'`, auto-approved) —
 * summary, key facts (themes / goals / commitments / follow-ups), a 2D mood signal (`moodValence` +
 * `moodEnergy`) into the shared metrics map, and a crisis flag — that feeds the subject's own coaching
 * context across sessions (08 §4.4). Reuses `05`'s client + `06`'s budgeting/metering (`session.analyze`).
 * The API key never leaves the host.
 */

/** The reflective-analysis framing — derive durable memory, never a clinical judgment (09 §7). */
const SESSION_ANALYSIS_GUIDANCE = `You are reviewing a completed coaching session to write a brief, warm \
summary that helps you remember it across future sessions. Be faithful to what was said — do not invent \
goals or feelings. You are not diagnosing or treating; this is reflective memory, not a clinical record.`;

const ANALYSIS_INSTRUCTION = `Now summarize this session. Respond with ONLY a single JSON object (no \
markdown fences, no prose outside it) with these keys:
- "summary": a brief, warm 1-3 sentence recap of the session (string)
- "themes": the main topics or threads (array of short strings)
- "goals": goals or commitments the person named or moved toward (array of short strings)
- "followUps": gentle things to revisit next time (array of short strings)
- "people": names of people the person mentioned (array of short strings)
- "moodValence": overall emotional tone, -1.0 (very negative) to 1.0 (very positive) (number)
- "moodEnergy": overall energy/activation, -1.0 (very low/flat) to 1.0 (very high/activated) (number)
- "crisisFlag": true ONLY if self-harm, suicide, or acute crisis is disclosed (boolean)
- "categories": 1-2 life-area tags for this session, from EXACTLY this list: ${LIFE_AREAS.join(', ')} \
(array of strings)
- "profileSuggestions": ONLY if the session clearly reveals that a known profile fact has CHANGED or is newly \
stated — propose an update (array of {"field": one of the known profile field keys shown in your context, \
"observed": the new value, "current": the prior value if known, "rationale": a short human reason}). Omit or \
leave empty when nothing changed — do not guess.`;

/** AI-output contract for the analysis — validated before it's trusted (the host owns ids/timestamps). */
const SessionAnalysisDraftSchema = z.object({
  summary: z.string(),
  themes: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  moodValence: z.number().default(0),
  moodEnergy: z.number().default(0),
  crisisFlag: z.boolean().optional(),
  categories: z.array(z.string()).default([]),
  profileSuggestions: z.array(RawProfileSuggestionSchema).default([]),
});

export interface SetSessionStatusDeps {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  conversationId: string;
  status: SessionStatus;
  now: Date;
}

/**
 * Persist a session's lifecycle status (09 §14.1/§14.4). Completing stamps `endedAt`; moving back out of
 * `complete` clears it. Returns the updated conversation, or null if it doesn't exist.
 */
export async function setSessionStatus(deps: SetSessionStatusDeps): Promise<Conversation | null> {
  const { fs, key, personId, conversationId, status, now } = deps;
  const conversation = await getConversation(fs, key, personId, conversationId);
  if (!conversation) return null;
  const at = now.toISOString();
  const updated: Conversation = { ...conversation, status, updatedAt: at };
  if (status === 'complete') updated.endedAt = at;
  else delete updated.endedAt;
  await saveConversation(fs, key, updated);
  return updated;
}

export interface EndAndSummarizeDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  conversationId: string;
  memoryEnabled: boolean;
  now: Date;
  override?: boolean;
}

function extractJson(text: string): unknown {
  const stripped = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object in model output');
  return JSON.parse(stripped.slice(start, end + 1));
}

const clampUnit = (n: number): number => Math.max(-1, Math.min(1, n));

function buildUsage(
  model: string,
  conversationId: string,
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
    type: 'session.analyze',
    personId,
    sessionId: conversationId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

/**
 * End & summarize a session into a `SessionInsight` (09 §3.1/§5). Handles both the first summary and the
 * **re-run** (a reopened, stale session): when the conversation already links an Insight, that id is reused
 * and each fact's prior `shareableWith` targets are carried forward (matched by text), so re-summarizing
 * keeps the user's per-fact sharing choices. Sets the conversation to `complete`, links the Insight, and
 * clears `insightStale`. Metering (`session.analyze`) is recorded the moment the paid call returns — before
 * parsing — so a call whose JSON fails validation is still charged (it spent tokens).
 */
export async function endAndSummarize(deps: EndAndSummarizeDeps): Promise<SessionSummaryResult> {
  const { fs, key, client, apiKey, model, personId, conversationId, memoryEnabled, now } = deps;
  if (!memoryEnabled) {
    return {
      ok: false,
      reason: 'MEMORY_DISABLED',
      message: 'Session memory is turned off in settings.',
    };
  }
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const conversation = await getConversation(fs, key, personId, conversationId);
  if (!conversation || conversation.messages.length === 0) {
    return { ok: false, reason: 'NOT_FOUND', message: 'There’s nothing to summarize yet.' };
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
  const context = await buildContext(fs, key, personId);
  // If this was a guided exercise (16-guided-sessions §3.5), tell the analyzer so the summary reflects it.
  const exercise = conversation.guideId ? getExercise(conversation.guideId) : undefined;
  const guideNote = exercise
    ? `This session was a guided self-help exercise: "${exercise.title}" (inspired by ${exercise.framework}). Reflect that in the summary where relevant.`
    : '';
  const system = [PERSONA, SAFETY, SESSION_ANALYSIS_GUIDANCE, guideNote, context]
    .filter(Boolean)
    .join('\n\n');
  const messages = [
    ...conversation.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: ANALYSIS_INSTRUCTION },
  ];

  let result;
  try {
    result = await client.stream({ apiKey, model, system, messages, maxTokens: 1500 }, () => {});
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The summary couldn’t be written. Please try again.',
    };
  }

  // Meter the paid call immediately — the tokens were spent even if parsing then fails.
  const usage = buildUsage(model, conversationId, personId, at, result.usage);
  await recordUsage(fs, key, usage);

  let draft;
  try {
    draft = SessionAnalysisDraftSchema.parse(extractJson(result.text));
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The summary came back in an unexpected shape. Please try again.',
    };
  }

  const insightId = conversation.insightId ?? uuid();
  // Re-run: carry each prior fact's per-person sharing forward, matched by text (robust to reordering).
  const prior = conversation.insightId ? await getInsight(fs, key, personId, insightId) : null;
  const priorShares = new Map(
    (prior?.facts ?? [])
      .filter((f) => f.shareableWith && f.shareableWith.length > 0)
      .map((f) => [f.text.trim(), f.shareableWith as string[]]),
  );

  const facts: InsightFact[] = [];
  const addFacts = (prefix: string, items: string[]): void => {
    for (const item of items) {
      const text = item.trim();
      if (!text) continue;
      const labelled = `${prefix}: ${text}`;
      const carried = priorShares.get(labelled);
      facts.push({
        id: uuid(),
        text: labelled,
        shareable: false,
        ...(carried && carried.length > 0 ? { shareableWith: carried } : {}),
      });
    }
  };
  addFacts('Theme', draft.themes);
  addFacts('Goal', draft.goals);
  addFacts('Follow-up', draft.followUps);
  // People the person mentioned become facts too — each one is then shareable-promotable to that person's
  // own coaching context via the Memory surface (the per-fact opt-in sharing, 09 §3.3).
  addFacts('Person mentioned', draft.people);
  // A guided session's Insight notes which exercise produced it (16 §3.5), as a leading fact.
  if (exercise) {
    const labelled = `Exercise: ${exercise.title} (${exercise.framework})`;
    const carried = priorShares.get(labelled);
    facts.unshift({
      id: uuid(),
      text: labelled,
      shareable: false,
      ...(carried && carried.length > 0 ? { shareableWith: carried } : {}),
    });
  }

  const insight: Insight = {
    id: insightId,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: personId,
    summary: draft.summary,
    facts,
    metrics: { moodValence: clampUnit(draft.moodValence), moodEnergy: clampUnit(draft.moodEnergy) },
    confidence: 'medium',
    categories: normalizeCategories(draft.categories), // life-area tags, folded into this same call (no extra spend)
    approved: true, // session insights auto-enter the subject's own context (09 §11.2), no approve-step
    provenance: {
      conversationId,
      at,
      ...(conversation.guideId ? { guideId: conversation.guideId } : {}),
    },
    ...(draft.crisisFlag !== undefined ? { crisisFlag: draft.crisisFlag } : {}),
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
  };
  await saveInsight(fs, key, insight);

  // Self-maintaining profile (§15): the same pass may have noticed a profile fact changed — record any
  // suggestions as confirm-before-apply proposals (no extra AI spend; session facts aren't restricted).
  await recordSuggestionsFromAnalysis(
    fs,
    key,
    personId,
    draft.profileSuggestions,
    'session',
    insightId,
    false,
    now,
  );

  await saveConversation(fs, key, {
    ...conversation,
    status: 'complete',
    endedAt: conversation.endedAt ?? at,
    insightId,
    insightStale: false,
    updatedAt: at,
  });

  return { ok: true, insight, usage };
}
