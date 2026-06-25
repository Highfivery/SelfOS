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
import { buildSystemPrompt } from './promptBuilder';
import { WRAP_UP_INSTRUCTION, WRAP_UP_MARKER } from './wrapUp';
import { getExercise } from './guidedCatalog';
import { parseLatestStep, stripCoachMarkers } from './guidedSteps';
import { TOPIC_MODEL, classifyTopic, topicShifted } from './topicClassifier';

export type { ChatTurnResult };

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
  const { fs, key, client, apiKey, model, personId, conversationId, userText, now } = deps;
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

  // The wrap-up instruction teaches the coach the private completion-marker convention; the guided
  // addendum (if `guideId` is set) steers the turn after persona+safety+context (16 §5).
  const system = `${await buildSystemPrompt(fs, key, personId, conversation.guideId, deps.depthAsk, topicOverride, deps.goalRaise)}\n\n${WRAP_UP_INSTRUCTION}`;
  // 45 §6.1 — re-read any attached images host-side and assemble vision content blocks for this turn (and for
  // every earlier attached message still in history, since Claude is stateless).
  const claudeMessages = await buildClaudeMessages(fs, key, conversation.messages);
  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system,
        messages: claudeMessages,
        maxTokens: 1024,
      },
      deps.onDelta,
    );
  } catch {
    return { ok: false, reason: 'ERROR', message: 'The coach couldn’t respond. Please try again.' };
  }

  // Detect + strip the private coach markers (wrap-up + step) so they're never persisted or shown.
  const wrapUpSuggested = result.text.includes(WRAP_UP_MARKER);
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
  await saveConversation(fs, key, conversation);

  const usage: UsageEvent = {
    id: uuid(),
    schemaVersion: 1,
    type: 'chat',
    personId,
    sessionId: conversation.id,
    model,
    at,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    costUsd: costOf(model, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    }),
  };
  await recordUsage(fs, key, usage);
  // Meter the classifier call too, if it ran (28 §13.2) — a separate `session.topic` event.
  if (topicUsage) await recordUsage(fs, key, topicUsage);

  return { ok: true, conversation, usage, ...(wrapUpSuggested ? { wrapUpSuggested } : {}) };
}
