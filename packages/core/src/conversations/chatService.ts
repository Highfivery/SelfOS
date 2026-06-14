import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import type { ChatTurnResult, Conversation, UsageEvent } from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { getConversation, saveConversation } from './conversationService';
import { buildSystemPrompt } from './promptBuilder';
import { WRAP_UP_INSTRUCTION, WRAP_UP_MARKER, stripWrapUpMarker } from './wrapUp';

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
  onDelta: (text: string) => void;
  now: Date;
  override?: boolean;
}

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || 'New conversation';
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
    title: deriveTitle(userText),
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
  conversation.messages.push({ role: 'user', content: userText, ts: at });

  // The wrap-up instruction (chat sessions only) teaches the coach the private completion-marker convention.
  const system = `${await buildSystemPrompt(fs, key, personId)}\n\n${WRAP_UP_INSTRUCTION}`;
  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system,
        messages: conversation.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        maxTokens: 1024,
      },
      deps.onDelta,
    );
  } catch {
    return { ok: false, reason: 'ERROR', message: 'The coach couldn’t respond. Please try again.' };
  }

  // Detect + strip the private wrap-up marker so it's never persisted or shown; surface it as a hint.
  const wrapUpSuggested = result.text.includes(WRAP_UP_MARKER);
  conversation.messages.push({
    role: 'assistant',
    content: stripWrapUpMarker(result.text),
    ts: at,
  });
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

  return { ok: true, conversation, usage, ...(wrapUpSuggested ? { wrapUpSuggested } : {}) };
}
