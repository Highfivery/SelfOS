import type { ClaudeClient, ClaudeMessage, ContentBlock, FileSystem } from '../host';
import { toBase64 } from '../encoding';
import { uuid } from '../id';
import type {
  AttachmentRef,
  ChatMessage,
  ChatTurnResult,
  Conversation,
  UsageEvent,
} from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import type { DepthAskContext } from '../profile';
import type { GoalRaiseContext } from '../coaching/goalRaise';
import {
  getConversation,
  getConversationAttachment,
  saveConversation,
} from './conversationService';
import { getGuidancePrefs } from './guidanceService';
// Import the specific file (not the `../challenges` barrel) so loading `conversations` never pulls
// `challengeSuggestService`, which imports `conversations/promptBuilder` — keeping the one runtime edge
// (`conversations → challenges/challengeService`) acyclic (52 §5.1).
import { captureFromMarker } from '../challenges/challengeService';
import { buildSystemPrompt } from './promptBuilder';
import { WRAP_UP_INSTRUCTION, WRAP_UP_MARKER } from './wrapUp';
import { getExercise } from './guidedCatalog';
import { CHALLENGE_COACH_ID } from './challengeCoach';
import { parseChallengeMarker, parseLatestStep, stripCoachMarkers } from './guidedSteps';
import { TOPIC_MODEL, classifyTopic, topicShifted } from './topicClassifier';
import { streamWithContinuation } from './streamWithContinuation';

export type { ChatTurnResult };

// The visible-reply token ceiling for a coaching turn. Generous because a reply can run several paragraphs AND
// adaptive thinking shares this budget — a small ceiling starved replies to empty (the "thinking then nothing"
// bug). A ceiling isn't a target (you pay only for tokens generated), so this doesn't raise normal-turn cost.
const CHAT_MAX_TOKENS = 4096;

/** Build the `chat` usage event for one turn (billed even when the reply came back empty). */
function buildChatUsage(
  sessionId: string,
  personId: string,
  model: string,
  at: string,
  u: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'chat',
    personId,
    sessionId,
    model,
    at,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    cacheReadTokens: u.cacheReadTokens,
    costUsd: costOf(model, u),
  };
}

export interface ChatTurnDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  conversationId: string;
  userText: string;
  /** Image attachments on the NEW user message (45 §3.2). Already stored (refs from `storeAttachment`); the
   *  bytes are re-read host-side each turn to build vision content blocks (§6.1). Absent ⇒ a text-only turn. */
  attachments?: AttachmentRef[];
  onDelta: (text: string) => void;
  /** The optional in-session depth ask (29 §3.5) — the unexplored invited sections to gently invite. The host
   *  computes this (setting on + intake read + 18+-ack adult filtering); absent ⇒ no in-session ask. */
  depthAsk?: DepthAskContext;
  /** The optional in-session goal-raise (40 §3.1) — the host computes this (proactivity on + active goals);
   *  absent ⇒ no proactive follow-up this turn. Rides the same turn; no extra Claude call. */
  goalRaise?: GoalRaiseContext;
  now: Date;
  override?: boolean;
}

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || 'New conversation';
}

/**
 * Build the Claude message list for a turn (45 §6.1). Claude is stateless, so EVERY turn re-supplies the full
 * history — for any message carrying `attachments`, re-read each stored `.enc` host-side (via `fs` + the
 * master key), base64-encode, and emit a content-block array. A message with no attachments stays a plain
 * string. A missing/corrupt attachment is SKIPPED (the message degrades to its text), never throwing, so the
 * turn still completes. Image bytes never round-trip through the renderer for the model call.
 */
async function buildClaudeMessages(
  fs: FileSystem,
  key: Uint8Array,
  messages: ChatMessage[],
): Promise<ClaudeMessage[]> {
  const out: ClaudeMessage[] = [];
  for (const message of messages) {
    if (!message.attachments || message.attachments.length === 0) {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    const images: ContentBlock[] = [];
    for (const ref of message.attachments) {
      const bytes = await getConversationAttachment(fs, key, ref.path);
      if (!bytes) continue; // skip a missing/corrupt attachment; the turn still completes
      images.push({
        type: 'image',
        source: { type: 'base64', media_type: ref.mime, data: toBase64(bytes) },
      });
    }
    // If no image survived, degrade to the plain-string text message (never an empty content array).
    if (images.length === 0) {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    const blocks: ContentBlock[] = message.content
      ? [{ type: 'text', text: message.content }, ...images]
      : images;
    out.push({ role: message.role, content: blocks });
  }
  return out;
}

/** A `session.topic` usage event for the (cheap, Haiku) free-form topic classifier (28 §13.2). */
function buildTopicUsage(
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
    type: 'session.topic',
    personId,
    sessionId: conversationId,
    model: TOPIC_MODEL,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(TOPIC_MODEL, usage),
  };
}

/**
 * Run one chat turn (05/06): enforce budgets, stream the reply, append both messages to the encrypted
 * transcript, and record a usage event. The API key never leaves the main process.
 */
export async function runChatTurn(deps: ChatTurnDeps): Promise<ChatTurnResult> {
  const { fs, key, client, apiKey, personId, conversationId, userText, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const personBudget = await checkBudget(fs, key, {
    scope: 'person',
    personId,
    now,
    override: deps.override,
  });
  const appBudget = await checkBudget(fs, key, {
    scope: 'app',
    now,
    override: deps.override,
  });
  if (personBudget.state === 'over' || appBudget.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();
  const existing = await getConversation(fs, key, personId, conversationId);
  const conversation: Conversation = existing ?? {
    id: conversationId,
    schemaVersion: 1,
    personId,
    title: userText.trim()
      ? deriveTitle(userText)
      : deps.attachments && deps.attachments.length > 0
        ? 'Shared an image'
        : deriveTitle(userText),
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
  // Continuing a completed session reopens it (09 §14.4) — back to in-progress, and its Insight (if any)
  // goes stale so the next "End & summarize" re-analyzes rather than serving an out-of-date memory.
  if (conversation.status === 'complete') {
    conversation.status = 'inProgress';
    delete conversation.endedAt;
    if (conversation.insightId) conversation.insightStale = true;
  }
  // The prior assistant turn (for the topic classifier's context) — grabbed BEFORE the new user message is
  // pushed, so it's the genuine previous reply.
  const priorAssistant = [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'assistant')?.content;
  conversation.messages.push({
    role: 'user',
    content: userText,
    ts: at,
    ...(deps.attachments && deps.attachments.length > 0 ? { attachments: deps.attachments } : {}),
  });
  // Persist the user's message BEFORE the reply (05 §4.1) — so a failed turn never loses it: the transcript
  // ends with the user's message and can be retried (from here, or after re-opening the session later).
  conversation.updatedAt = at;
  await saveConversation(fs, key, conversation);

  // Free-form session topic (28 §13.2): infer the relevant life-areas from the message with a cheap Haiku
  // classifier so the pinned portrait surfaces the facts that matter here. Cached on the conversation and
  // re-run ONLY on a subject shift. Guided sessions skip it (their topic comes from the exercise group).
  // Fail-open: any error keeps the cached topic (or none on turn 1) and never blocks the reply.
  let topicOverride = conversation.topicLifeAreas
    ? { lifeAreas: conversation.topicLifeAreas }
    : undefined;
  let topicUsage: UsageEvent | undefined;
  if (!conversation.guideId && topicShifted(userText, conversation.topicLifeAreas)) {
    const classified = await classifyTopic({
      client,
      apiKey,
      userText,
      ...(priorAssistant !== undefined ? { priorAssistant } : {}),
    });
    if (classified) {
      conversation.topicLifeAreas = classified.lifeAreas;
      topicOverride = { lifeAreas: classified.lifeAreas };
      topicUsage = buildTopicUsage(conversation.id, personId, at, classified.usage);
    }
  }

  return generateCoachReply(deps, conversation, topicOverride, topicUsage);
}

/**
 * Stream the coach's reply for a conversation whose transcript already ends with the user's message, append +
 * persist it, meter, and run the post-turn machinery (wrap-up hint, guided step, challenge capture). Shared by
 * `runChatTurn` (after it appends the new user message) and `retryReply` (which re-runs on the existing
 * transcript). A blank reply is an honest `EMPTY` failure that is never persisted (05 §4.1).
 */
async function generateCoachReply(
  deps: Pick<
    ChatTurnDeps,
    | 'fs'
    | 'key'
    | 'client'
    | 'apiKey'
    | 'model'
    | 'personId'
    | 'now'
    | 'onDelta'
    | 'depthAsk'
    | 'goalRaise'
    // 66 §5.1 — the continuation gate re-checks the budget, which honours the owner override.
    | 'override'
  >,
  conversation: Conversation,
  topicOverride: { lifeAreas: string[] } | undefined,
  topicUsage: UsageEvent | undefined,
): Promise<ChatTurnResult> {
  const { fs, key, client, apiKey, model, personId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const at = now.toISOString();
  // 52 §8.3 — the challenge-coach's EXPLICIT sexual register is gated on the per-person 18+ ack. Read it ONLY
  // for a challenge-coach session (so an un-acked person who steers toward sex is redirected, not engaged); a
  // single cheap read, scoped to challenge sessions, keeps the ack enforcement in core (not just the bridge).
  const adultAllowed =
    conversation.guideId === CHALLENGE_COACH_ID
      ? (await getGuidancePrefs(fs, key, personId)).adultAcknowledged === true
      : false;
  // The wrap-up instruction teaches the coach the private completion-marker convention; the guided
  // addendum (if `guideId` is set) steers the turn after persona+safety+context (16 §5).
  const system = `${await buildSystemPrompt(fs, key, personId, conversation.guideId, deps.depthAsk, topicOverride, deps.goalRaise, adultAllowed)}\n\n${WRAP_UP_INSTRUCTION}`;
  // 45 §6.1 — re-read any attached images host-side and assemble vision content blocks for this turn (and for
  // every earlier attached message still in history, since Claude is stateless).
  const claudeMessages = await buildClaudeMessages(fs, key, conversation.messages);
  let result;
  try {
    result = await streamWithContinuation(
      client,
      {
        apiKey,
        model,
        system,
        messages: claudeMessages,
        // A coaching reply can run several paragraphs, and adaptive thinking SHARES this budget — too small a
        // ceiling starved the visible reply to empty/truncated (the reported "thinking then nothing" bug). This
        // is a ceiling, not a target (you only pay for tokens generated), so a generous budget is safe.
        maxTokens: CHAT_MAX_TOKENS,
      },
      deps.onDelta,
      {
        // 66 §3.1 — if the reply still hits the ceiling, continue it silently rather than persisting a
        // half-finished one. Re-check the budget before each continuation: it's a fresh billed call.
        canContinue: async () =>
          !(
            (
              await checkBudget(fs, key, {
                scope: 'person',
                personId,
                now,
                override: deps.override,
              })
            ).state === 'over' ||
            (await checkBudget(fs, key, { scope: 'app', now, override: deps.override })).state ===
              'over'
          ),
      },
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The coach couldn’t respond — check your connection and try again.',
    };
  }

  // Meter the billed call FIRST (even a blank reply consumed input + thinking tokens) — then decide.
  const usage = buildChatUsage(conversation.id, personId, model, at, result.usage);
  await recordUsage(fs, key, usage);

  // A blank reply is a FAILURE, not a silently-saved empty message (05 §4.1). It happens when adaptive thinking
  // starves the max_tokens budget (stop_reason max_tokens, no visible text). Surface it so the user can retry —
  // and never persist an empty assistant turn into the transcript (the user's message stays, already saved).
  if (result.text.trim() === '') {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'The coach’s reply came back empty — please try again.',
    };
  }

  // Detect + strip the private coach markers (wrap-up + step + challenge) so they're never persisted or shown.
  const wrapUpSuggested = result.text.includes(WRAP_UP_MARKER);
  // 52 §3.2 — only a challenge-coach session captures an agreed challenge from a marker (parsed from the raw
  // reply BEFORE stripping; created after the transcript is saved, riding this paid turn — no extra call).
  const challengeMarker =
    conversation.guideId === CHALLENGE_COACH_ID ? parseChallengeMarker(result.text) : null;
  conversation.messages.push({
    role: 'assistant',
    content: stripCoachMarkers(result.text),
    ts: at,
  });
  // For a structured guided exercise, advance the stepper to the step the coach declared this turn
  // (best-effort orientation — never blocks free input). Clamp to the exercise's real step range.
  const exercise = conversation.guideId ? getExercise(conversation.guideId) : undefined;
  if (exercise?.kind === 'structured' && exercise.steps) {
    const step = parseLatestStep(result.text);
    if (step !== null)
      conversation.guideStep = Math.max(0, Math.min(step, exercise.steps.length - 1));
  }
  conversation.updatedAt = at;
  // Re-read before writing. `conversation` was captured BEFORE the stream (10-60s), and other whole-record
  // writers touch this same file meanwhile — `conversationsRename` and `sessions:setStatus` — so writing our
  // copy back would silently revert a rename made while the coach was replying. The transcript is ours (only
  // this path appends messages); everything else comes from the live record. A `null` read means the session
  // was deleted mid-turn: leave it deleted rather than resurrecting it.
  const live = await getConversation(fs, key, conversation.personId, conversation.id);
  if (live) {
    await saveConversation(fs, key, {
      ...live,
      messages: conversation.messages,
      // Fields this turn legitimately owns alongside the transcript: the stepper and the classified
      // topic cache (28 §13.2), both computed from this turn. Everything else stays as the live record
      // has it (title from a concurrent rename, status from a concurrent set-status).
      ...(conversation.guideStep !== undefined ? { guideStep: conversation.guideStep } : {}),
      ...(conversation.topicLifeAreas !== undefined
        ? { topicLifeAreas: conversation.topicLifeAreas }
        : {}),
      // Reopening a completed session (09 §14.4) is ALSO ours, and `retryReply` relies on this write to
      // persist it — derive it from the LIVE record so `...live` can't reinstate `complete`/`endedAt` or
      // swallow the staleness flag. Without this a retried reply lands on a session still marked wrapped
      // up, with its Insight silently no longer matching the transcript.
      ...(live.status === 'complete'
        ? {
            status: 'inProgress' as const,
            endedAt: undefined,
            ...(live.insightId ? { insightStale: true } : {}),
          }
        : {}),
      updatedAt: at,
    });
  }

  // Meter the classifier call too, if it ran (28 §13.2) — a separate `session.topic` event.
  if (topicUsage) await recordUsage(fs, key, topicUsage);

  // 52 §3.2 — the agreed challenge is created AFTER the transcript is saved (so its conversationId is real).
  // The one-active rule lives in `captureFromMarker` (§4.3); a malformed marker already parsed to null.
  let challengeCreated: { id: string; action: string } | undefined;
  if (challengeMarker) {
    const challenge = await captureFromMarker({
      fs,
      key,
      personId,
      conversationId: conversation.id,
      marker: challengeMarker,
      now,
    });
    if (challenge) challengeCreated = { id: challenge.id, action: challenge.action };
  }

  return {
    ok: true,
    conversation,
    usage,
    ...(wrapUpSuggested ? { wrapUpSuggested } : {}),
    ...(challengeCreated ? { challengeCreated } : {}),
  };
}

/** Deps for `retryReply` — the same as a chat turn, minus the (already-persisted) user text + attachments. */
export type RetryReplyDeps = Omit<ChatTurnDeps, 'userText' | 'attachments'>;

/**
 * Re-generate the coach's reply for a conversation whose LAST message is an unanswered user message (05 §4.1) —
 * e.g. after an empty/failed turn, or on re-opening a session that ended on the user's message. Does NOT add a
 * new user message (so it never duplicates); reuses the cached topic. Budget-gated + metered like a normal turn.
 */
export async function retryReply(deps: RetryReplyDeps): Promise<ChatTurnResult> {
  const { fs, key, apiKey, model, personId, conversationId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const personBudget = await checkBudget(fs, key, {
    scope: 'person',
    personId,
    now,
    override: deps.override,
  });
  const appBudget = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (personBudget.state === 'over' || appBudget.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }
  const conversation = await getConversation(fs, key, personId, conversationId);
  if (!conversation) {
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  }
  // Drop any trailing BLANK assistant message(s) first — the pre-05 §4.1 code persisted an empty
  // `{ role: 'assistant', content: '' }` bubble when a reply came back empty (adaptive-thinking starvation),
  // so a session that failed BEFORE the fail-safe shipped ends on that ghost, not on the user's message. We
  // strip it so the transcript ends on the user's message and can be answered (the cleanup persists on the
  // success save below); legitimate assistant replies always have content, so this only ever removes ghosts.
  while (conversation.messages.length > 0) {
    const tail = conversation.messages[conversation.messages.length - 1];
    if (tail && tail.role === 'assistant' && tail.content.trim() === '')
      conversation.messages.pop();
    else break;
  }
  const last = conversation.messages[conversation.messages.length - 1];
  if (last?.role !== 'user') {
    // Nothing to retry — the last turn already has a real reply (or the session is empty). A no-op failure.
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  }
  // Continuing a completed session reopens it (09 §14.4), mirroring runChatTurn. The reopen persists on the
  // success path inside `generateCoachReply`, which derives it from the record it re-reads — so it survives
  // that re-read. Reachable: a failed turn leaves the transcript ending on the user's message, the session
  // can then be wrapped up, and the Try-again banner is gated on the transcript shape, not on status.
  if (conversation.status === 'complete') {
    conversation.status = 'inProgress';
    delete conversation.endedAt;
    if (conversation.insightId) conversation.insightStale = true;
  }
  const topicOverride = conversation.topicLifeAreas
    ? { lifeAreas: conversation.topicLifeAreas }
    : undefined;
  return generateCoachReply({ ...deps, model }, conversation, topicOverride, undefined);
}
