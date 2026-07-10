import type { ClaudeClient, ClaudeMessage, FileSystem } from '../host';
import { uuid } from '../id';
import type { ContextTopic, TogetherMessage, TogetherSession, UsageEvent } from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { getPerson } from '../people';
import { stripCoachMarkers } from '../conversations/guidedSteps';
import { appendMessage, getSession, listMessages } from './togetherService';
import { buildTogetherSystemPrompt } from './togetherPromptBuilder';

// ── The couples turn (58 §5.1) — a sibling of `runChatTurn` (05 §4.1), not a change to it ─────────
// Invariants held verbatim: budget gate (the INITIATOR pays, §6.2) → persist the author's message FIRST
// (write-once) → stream → METER FIRST (together.chat, personId: initiator) → EMPTY fail-safe (never persist
// a blank turn) → strip markers → persist the coach message. An ASIDE turn produces a `privateAside` coach
// reply carrying the aside author's id (so the projection hides the whole exchange, §3.6) and mints no shared
// artifacts / advances no step. Streaming is on the sending device only (honest async, §5.4).

// A generous reply ceiling — adaptive thinking SHARES this budget, so a small ceiling starves the reply to
// empty (the 05 "thinking then nothing" trap). A ceiling isn't a target, so this doesn't raise normal cost.
const TOGETHER_MAX_TOKENS = 4096;
// The most-recent transcript window sent per turn (§7 — bounded prompt). Older content is carried by the
// grounding pack + (Phase D) the report summary. Tunable with real token counts (§11 Q3); 40 is a safe start.
const TOGETHER_TRANSCRIPT_WINDOW = 40;

export interface TogetherTurnDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  /** The session (already loaded by the bridge, membership + edge + pre-screen already gated). */
  session: TogetherSession;
  /** Who is writing this turn (the active person). The coach reply carries this id too (§4.2). */
  authorPersonId: string;
  userText: string;
  /** A private aside — the whole exchange (this message + the coach reply) is author-only (§3.6). */
  privateAside?: boolean;
  /** The call topic (Phase E guided sessions derive it from the catalog); absent ⇒ core + fill. */
  topic?: ContextTopic;
  /** Whether every participant has acknowledged adult content — gates the explicit register (Phase F). */
  allAdultAcked?: boolean;
  onDelta: (text: string) => void;
  now: Date;
  override?: boolean;
}

export type TogetherTurnOutcome =
  | { ok: true; usage: UsageEvent }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'EMPTY' | 'ERROR'; message: string };

function buildTogetherUsage(
  session: TogetherSession,
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
    type: 'together.chat',
    // Billing (§6.2): the INITIATOR pays for every AI spend in the shared session, regardless of who writes.
    personId: session.initiatorPersonId,
    sessionId: session.id,
    model,
    at,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    cacheReadTokens: u.cacheReadTokens,
    costUsd: costOf(model, u),
  };
}

/**
 * Build the Claude message list from the transcript: each human message prefixed with its author's name (an
 * aside gets the `[PRIVATE ...]` prefix so the coach knows it's confidential, §6.3); the coach's own messages
 * stay assistant. Consecutive same-role messages are MERGED (two partners can write before a reply — the API
 * requires alternating roles), and the list is trimmed to start on a user message. Text-only in Phase B
 * (attachments arrive in Phase C).
 */
function buildTogetherClaudeMessages(
  messages: TogetherMessage[],
  nameOf: (personId: string) => string,
): ClaudeMessage[] {
  const windowed = messages.slice(-TOGETHER_TRANSCRIPT_WINDOW);
  const built: ClaudeMessage[] = windowed.map((m) => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content };
    const name = nameOf(m.authorPersonId);
    const prefix = m.privateAside
      ? `[PRIVATE from ${name} — only ${name} can see this] `
      : `${name}: `;
    return { role: 'user', content: `${prefix}${m.content}` };
  });
  const merged: ClaudeMessage[] = [];
  for (const cm of built) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.role === cm.role &&
      typeof last.content === 'string' &&
      typeof cm.content === 'string'
    ) {
      last.content = `${last.content}\n\n${cm.content}`;
    } else {
      merged.push({ role: cm.role, content: cm.content });
    }
  }
  while (merged.length > 0 && merged[0]?.role !== 'user') merged.shift();
  return merged;
}

async function resolveNames(
  fs: FileSystem,
  key: Uint8Array,
  session: TogetherSession,
): Promise<(personId: string) => string> {
  const names = new Map<string, string>();
  for (const pid of session.participantIds) {
    names.set(pid, (await getPerson(fs, key, pid))?.displayName ?? 'this partner');
  }
  return (pid: string): string => names.get(pid) ?? 'this partner';
}

/**
 * Stream the coach's reply for a transcript that already ends with the newest human message. Shared by
 * `runTogetherTurn` (after it persists the author's message) and `retryTogetherReply`. A blank reply is an
 * honest EMPTY failure, never persisted. `authorPersonId`/`privateAside` describe the turn being answered.
 */
async function generateCoachReply(
  deps: Omit<TogetherTurnDeps, 'userText'>,
  authorPersonId: string,
  privateAside: boolean,
): Promise<TogetherTurnOutcome> {
  const { fs, key, client, apiKey, model, session, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const at = now.toISOString();
  const nameOf = await resolveNames(fs, key, session);
  const system = await buildTogetherSystemPrompt(fs, key, session, {
    ...(deps.topic ? { topic: deps.topic } : {}),
    ...(deps.allAdultAcked ? { allAdultAcked: true } : {}),
  });
  const messages = buildTogetherClaudeMessages(await listMessages(fs, key, session.id), nameOf);

  let result;
  try {
    result = await client.stream(
      { apiKey, model, system, messages, maxTokens: TOGETHER_MAX_TOKENS },
      deps.onDelta,
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The coach couldn’t respond — check your connection and try again.',
    };
  }

  // Meter the billed call FIRST (even a blank reply consumed input + thinking tokens), then decide (§5.1).
  const usage = buildTogetherUsage(session, model, at, result.usage);
  await recordUsage(fs, key, usage);

  if (result.text.trim() === '') {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'The coach’s reply came back empty — please try again.',
    };
  }

  // The coach reply carries the turn-runner's id (§4.2). On an ASIDE turn it is itself `privateAside`, so the
  // projection hides it from the partner (§3.6). Markers are stripped defensively (the Phase B addendum emits
  // none; the shared-artifact markers land in Phase D and are already suppressed on aside turns by design).
  const coachAt = new Date(now.getTime() + 1).toISOString();
  const reply = await lastHumanMessage(fs, key, session.id, authorPersonId);
  const coach: TogetherMessage = {
    id: uuid(),
    schemaVersion: 1,
    authorPersonId,
    role: 'assistant',
    content: stripCoachMarkers(result.text),
    ts: coachAt,
    ...(privateAside ? { privateAside: true } : {}),
    ...(reply ? { replyToMessageId: reply } : {}),
  };
  await appendMessage(fs, key, session.id, coach);
  return { ok: true, usage };
}

/** The id of the newest human message by `authorPersonId` — the message this coach reply answers. */
async function lastHumanMessage(
  fs: FileSystem,
  key: Uint8Array,
  sessionId: string,
  authorPersonId: string,
): Promise<string | null> {
  const messages = await listMessages(fs, key, sessionId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user' && m.authorPersonId === authorPersonId) return m.id;
  }
  return null;
}

/** Run one couples turn (§5.1). Persists the author's message before streaming, so a failed turn never loses it. */
export async function runTogetherTurn(deps: TogetherTurnDeps): Promise<TogetherTurnOutcome> {
  const { fs, key, session, authorPersonId, userText, now } = deps;
  if (!deps.apiKey)
    return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const personBudget = await checkBudget(fs, key, {
    scope: 'person',
    personId: session.initiatorPersonId, // the initiator pays (§6.2)
    now,
    override: deps.override,
  });
  const appBudget = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (personBudget.state === 'over' || appBudget.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  // Persist the author's message FIRST (write-once) — so a failed/interrupted turn never loses it (§5.1).
  const at = now.toISOString();
  await appendMessage(fs, key, session.id, {
    id: uuid(),
    schemaVersion: 1,
    authorPersonId,
    role: 'user',
    content: userText,
    ts: at,
    ...(deps.privateAside ? { privateAside: true } : {}),
  });

  return generateCoachReply(deps, authorPersonId, deps.privateAside === true);
}

/** Deps for a reply-only retry — the same as a turn, minus the (already-persisted) user text. */
export type TogetherRetryDeps = Omit<TogetherTurnDeps, 'userText' | 'privateAside'>;

/**
 * Re-generate the coach's reply for a session whose newest message is an unanswered HUMAN message (§7) —
 * regardless of which partner wrote it. Never adds a new human message (so it can't duplicate); strips any
 * trailing blank-assistant ghost first. If the newest human message is an aside, the retry replies privately.
 */
export async function retryTogetherReply(deps: TogetherRetryDeps): Promise<TogetherTurnOutcome> {
  const { fs, key, session, now } = deps;
  if (!deps.apiKey)
    return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const personBudget = await checkBudget(fs, key, {
    scope: 'person',
    personId: session.initiatorPersonId,
    now,
    override: deps.override,
  });
  const appBudget = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (personBudget.state === 'over' || appBudget.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const messages = await listMessages(fs, key, session.id);
  // Ignore any trailing blank-assistant ghost (defensive — the couples path never writes one, but the newest
  // REAL message is what matters). Find the newest non-blank message.
  let newest: TogetherMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && !(m.role === 'assistant' && m.content.trim() === '')) {
      newest = m;
      break;
    }
  }
  if (!newest || newest.role !== 'user') {
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  }
  return generateCoachReply(deps, newest.authorPersonId, newest.privateAside === true);
}

/** Load a session for a turn (used by the bridge before running a turn). Null if absent. */
export async function loadTogetherSession(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<TogetherSession | null> {
  return getSession(fs, key, id);
}
