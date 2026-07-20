import type { ClaudeClient, ClaudeMessage, ContentBlock, FileSystem } from '../host';
import { toBase64 } from '../encoding';
import { uuid } from '../id';
import type {
  AttachmentRef,
  ContextTopic,
  TogetherMessage,
  TogetherSession,
  UsageEvent,
} from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { getPerson } from '../people';
import {
  parseChallengeMarker,
  parseLatestStep,
  stripCoachMarkers,
} from '../conversations/guidedSteps';
import { parseAgreementMarker } from '../conversations/agreementMarker';
import { parseSuggestMarker } from '../conversations/suggestMarker';
import { parsePrivateMarker } from '../conversations/privateMarker';
import { getTogetherGuide } from './togetherCatalog';
import {
  appendMessage,
  getSession,
  getTogetherAttachment,
  isTombstone,
  listMessages,
} from './togetherService';
import { buildTogetherSystemPrompt } from './togetherPromptBuilder';
import { captureAgreementFromMarker } from './agreementService';
import { captureJointChallengeFromMarker } from './togetherChallengeService';
import { captureSuggestionFromMarker } from './suggestionService';
import { streamWithContinuation } from '../conversations/streamWithContinuation';

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
  /** The session (already loaded by the bridge, membership + edge already gated). */
  session: TogetherSession;
  /** Who is writing this turn (the active person). The coach reply carries this id too (§4.2). */
  authorPersonId: string;
  userText: string;
  /** Image attachments on the NEW message (58 §6.1) — already stored via `together:storeAttachment`; the bytes
   *  are re-read host-side each turn to build vision blocks. Absent ⇒ a text-only turn. */
  attachments?: AttachmentRef[];
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
async function buildTogetherClaudeMessages(
  fs: FileSystem,
  key: Uint8Array,
  messages: TogetherMessage[],
  nameOf: (personId: string) => string,
): Promise<ClaudeMessage[]> {
  // 66 §3.3 — tombstones are dropped BEFORE the window, so the model never sees a removal placeholder
  // and the window isn't spent on empty records.
  const windowed = messages.filter((m) => !isTombstone(m)).slice(-TOGETHER_TRANSCRIPT_WINDOW);
  // Each message → a role + its parts (a name-prefixed text part + any image blocks). Consecutive same-role
  // messages MERGE (two partners can write before a reply — the API requires alternating roles). A missing/
  // corrupt attachment is skipped so the turn still completes (the 45 §6.1 degrade rule).
  const groups: { role: 'user' | 'assistant'; parts: (string | ContentBlock)[] }[] = [];
  for (const m of windowed) {
    const name = nameOf(m.authorPersonId);
    const text =
      m.role === 'assistant'
        ? m.content
        : `${m.privateAside ? `[PRIVATE from ${name} — only ${name} can see this] ` : `${name}: `}${m.content}`;
    const parts: (string | ContentBlock)[] = [];
    if (text) parts.push(text);
    for (const ref of m.attachments ?? []) {
      const bytes = await getTogetherAttachment(fs, key, ref.path);
      if (bytes) {
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: ref.mime, data: toBase64(bytes) },
        });
      }
    }
    const last = groups[groups.length - 1];
    if (last && last.role === m.role) last.parts.push(...parts);
    else groups.push({ role: m.role, parts });
  }
  const out: ClaudeMessage[] = groups.map((g) => {
    const hasImage = g.parts.some((p) => typeof p !== 'string');
    if (!hasImage) {
      return {
        role: g.role,
        content: g.parts.filter((p): p is string => typeof p === 'string').join('\n\n'),
      };
    }
    const blocks: ContentBlock[] = g.parts.map((p) =>
      typeof p === 'string' ? { type: 'text', text: p } : p,
    );
    return { role: g.role, content: blocks };
  });
  while (out.length > 0 && out[0]?.role !== 'user') out.shift();
  return out;
}

/**
 * Resolve a `[[SELFOS:PRIVATE]]` marker's `to` (a display name the coach knows) to a participant id, or null
 * if it doesn't name a participant (§3.14 Part B — an unresolvable target is DROPPED, never broadcast). Matches
 * the display name case-insensitively; also accepts a raw participant id defensively.
 */
function resolvePrivateTarget(
  to: string,
  participantIds: string[],
  nameOf: (personId: string) => string,
): string | null {
  const target = to.trim().toLowerCase();
  if (!target) return null;
  // Match by display name (case-insensitive); accept a raw participant id defensively. If the display name is
  // AMBIGUOUS (two participants share it), drop rather than guess — the wrap-up-twin identical-name precedent.
  const byName = participantIds.filter((pid) => nameOf(pid).trim().toLowerCase() === target);
  if (byName.length === 1) return byName[0] ?? null;
  if (byName.length > 1) return null;
  const byId = participantIds.find((pid) => pid.toLowerCase() === target);
  return byId ?? null;
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
  const messages = await buildTogetherClaudeMessages(
    fs,
    key,
    await listMessages(fs, key, session.id),
    nameOf,
  );

  let result;
  try {
    result = await streamWithContinuation(
      client,
      { apiKey, model, system, messages, maxTokens: TOGETHER_MAX_TOKENS },
      deps.onDelta,
      {
        // 66 §3.1 — continue a cut-off couples reply silently; re-check the budget each time, since a
        // continuation is a fresh billed call charged to the initiator (§5.1).
        canContinue: async () =>
          !(
            (
              await checkBudget(fs, key, {
                scope: 'person',
                personId: session.initiatorPersonId,
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

  // Shared-artifact capture (§3.9/§6.4): a NON-aside coach reply may carry a `[[SELFOS:AGREEMENT:{…}]]` marker
  // → capture it into the pair ledger. An ASIDE turn mints NO shared artifacts by design (§3.6), so it's
  // skipped. A malformed marker yields no agreement (tolerant-parse). The marker itself is stripped below.
  if (!privateAside) {
    const marker = parseAgreementMarker(result.text);
    const [a, b] = session.participantIds;
    if (marker && a && b) {
      await captureAgreementFromMarker(fs, key, a, b, marker, session.id, now);
    }
    // A JOINT challenge (§5.6): a `[[SELFOS:CHALLENGE:{…}]]` marker mints twin `Challenge` records for BOTH
    // partners (shared `groupId`), each keeping their own 52 check-in cadence/card/reflection. Tolerant-parse;
    // asides mint nothing (§3.6). The marker is stripped from the saved + streamed text below.
    const challenge = parseChallengeMarker(result.text);
    if (challenge) {
      await captureJointChallengeFromMarker(
        fs,
        key,
        session.participantIds,
        challenge,
        session.id,
        now,
      );
    }
    // A coach SUGGESTION (§5.6): a `[[SELFOS:SUGGEST:{…}]]` marker drops a write-once card into the session
    // (a guided exercise to start / a check-in to seed). It NEVER auto-acts. Tolerant-parse; stripped below.
    const suggestion = parseSuggestMarker(result.text);
    if (suggestion) {
      await captureSuggestionFromMarker(fs, key, session.id, suggestion, now);
    }
  }

  // A coach-initiated PRIVATE clarification (§3.14 Part B): on an open turn the coach may append a
  // `[[SELFOS:PRIVATE:{"to","text"}]]` marker to reach ONE partner privately (verify something sensitive,
  // encourage them to raise it). It mints a SEPARATE `privateAside` coach message scoped to the resolved
  // target via `authorPersonId` (the projection hides it from the other partner), mints no shared artifact,
  // and never appears in the open transcript. An unresolvable `to` is dropped — no leak. Never on an aside
  // turn (an aside reply is already private to its author). Appended just below, after the public reply.
  let privateNote: { to: string; text: string } | null = null;
  if (!privateAside) {
    const priv = parsePrivateMarker(result.text);
    if (priv) {
      const targetId = resolvePrivateTarget(priv.to, session.participantIds, nameOf);
      if (targetId) privateNote = { to: targetId, text: priv.text };
    }
  }

  // The coach reply carries the turn-runner's id (§4.2). On an ASIDE turn it is itself `privateAside`, so the
  // projection hides it from the partner (§3.6). Markers (incl. AGREEMENT) are always stripped from the saved
  // + streamed text via `stripCoachMarkers`, so the token never shows.
  const coachAt = new Date(now.getTime() + 1).toISOString();
  const reply = await lastHumanMessage(fs, key, session.id, authorPersonId);
  // A structured guided couples session (§3.10): stamp the step the coach declared this turn onto the message
  // (parsed from its `[[SELFOS:STEP:n]]` marker, which is stripped from `content`), so the current step can be
  // DERIVED from the newest coach message — never stored on the single-writer session.enc. Never on an aside.
  const guide = session.guideId ? getTogetherGuide(session.guideId) : undefined;
  const declaredStep =
    !privateAside && guide?.kind === 'structured' ? parseLatestStep(result.text) : null;
  const coach: TogetherMessage = {
    id: uuid(),
    schemaVersion: 1,
    authorPersonId,
    role: 'assistant',
    content: stripCoachMarkers(result.text),
    ts: coachAt,
    ...(privateAside ? { privateAside: true } : {}),
    ...(reply ? { replyToMessageId: reply } : {}),
    ...(declaredStep !== null ? { guideStep: declaredStep } : {}),
  };
  await appendMessage(fs, key, session.id, coach);

  // Mint the coach's private clarification (§3.14 Part B), if one was declared and resolved. It is scoped to
  // the target partner via `privateAside` + `authorPersonId`, so `projectMessages` shows it ONLY to them; it
  // is a note, not a turn (it never flips the other partner's "your turn"). No shared artifact, no extra spend.
  if (privateNote) {
    await appendMessage(fs, key, session.id, {
      id: uuid(),
      schemaVersion: 1,
      authorPersonId: privateNote.to,
      role: 'assistant',
      content: privateNote.text,
      ts: new Date(now.getTime() + 2).toISOString(),
      privateAside: true,
      coachInitiated: true,
    });
  }

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
    ...(deps.attachments && deps.attachments.length > 0 ? { attachments: deps.attachments } : {}),
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
    // Skip blank ghosts AND removal tombstones (66 §3.3) — neither is a real turn. A tombstone is
    // already empty-content so the first clause catches it, but say so explicitly so this keeps holding
    // if a placeholder ever carries text.
    if (m && !isTombstone(m) && !(m.role === 'assistant' && m.content.trim() === '')) {
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
