import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import { FORMATTING } from '../conversations/promptBuilder';
import { streamWithContinuation } from '../conversations/streamWithContinuation';
import {
  regenerateIndexFor,
  reapDroppedAttachments,
  truncateMessages,
  type MessageStamp,
} from '../conversations/rewindService';
import { toBase64 } from '../encoding';
import type { ClaudeClient, ClaudeMessage, ContentBlock, FileSystem } from '../host';
import { uuid } from '../id';
import { deleteInsight, getInsight, producedFactShare, saveInsight } from '../insights';
import { getMedia, isAllowedImageMime, MAX_IMAGE_BYTES, storeMedia } from '../media';
import { z } from 'zod';
import {
  ConversationSchema,
  LIFE_AREAS,
  StoryMemorySchema,
  type AttachmentRef,
  type ChatMessage,
  type ChatTurnResult,
  type Conversation,
  type Insight,
  type InsightFact,
  type RewindResult,
  type StoryMemory,
  type StoryMemoryEdits,
  type StoryMemorySaveResult,
  type StoryMemorySynthesisResult,
  type StoryMemoryView,
  type UsageEvent,
} from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { BIOGRAPHY_BOOK_TYPE, MCADAMS_SCENES, getBookType } from './bookTypes';
import { buildBiographerSystem } from './storyPromptBuilder';
import { listBooks, listChapters } from './storyService';

/**
 * "Share a memory" (64-your-story §14) — the biographer interview chat + its synthesized memory. A person
 * tells their biographer about a moment; the biographer asks, listens, and goes deeper (the McAdams deepening
 * ladder), then — when it has enough — synthesizes a structured `StoryMemory` the person commits with one tap.
 *
 * Architecturally this is the DREAM-ANALYSIS chat (`dreamAnalysisService`) scoped under the book's owner: a
 * chat stored beside the memory record so the Sessions surface never lists it, the shared streaming spine
 * (`streamWithContinuation`, persist-user-first, meter-first, EMPTY fail-safe, `truncateMessages` rewind), a
 * readiness marker, an explicit synthesis, and a commit into an Insight. Memories are PERSON-level, so a saved
 * memory feeds EVERY book + the coach (via its Insight) and survives a book delete/rewrite.
 *
 * The AI key never leaves the host. Metered `story.memory` for the chat + synthesis.
 */

// --- Storage (person-level, under people/<personId>/story/memories/<memoryId>/) --------------------------

function memoriesDir(personId: string): string {
  return `people/${personId}/story/memories`;
}
function memoryDir(personId: string, memoryId: string): string {
  return `${memoriesDir(personId)}/${memoryId}`;
}
function memoryRecordPath(personId: string, memoryId: string): string {
  return `${memoryDir(personId, memoryId)}/memory.enc`;
}
function memoryConversationPath(personId: string, memoryId: string): string {
  return `${memoryDir(personId, memoryId)}/conversation.enc`;
}
/** The memory chat's encrypted image attachments (§14, the Sessions attachment precedent). */
export function memoryAttachmentsDir(personId: string, memoryId: string): string {
  return `${memoryDir(personId, memoryId)}/attachments`;
}
/** Guard: a path is one of OUR memory-attachment files — defense in depth for `getMedia`/`deleteMedia`. */
export function isMemoryAttachmentPath(path: string): boolean {
  return (
    /^people\/[^/]+\/story\/memories\/[^/]+\/attachments\/[^/]+\.enc$/.test(path) &&
    !path.includes('..')
  );
}

export async function saveMemoryRecord(
  fs: FileSystem,
  key: Uint8Array,
  memory: StoryMemory,
): Promise<void> {
  await writeEncryptedJson(fs, memoryRecordPath(memory.personId, memory.id), memory, key);
}

export async function getMemory(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  memoryId: string,
): Promise<StoryMemory | null> {
  const raw = await readEncryptedJson(fs, memoryRecordPath(personId, memoryId), key);
  if (!raw) return null;
  const memory = StoryMemorySchema.parse(raw);
  // Defense in depth: only serve a memory whose subject matches the folder (the dream/insight precedent).
  return memory.personId === personId ? memory : null;
}

/** Re-read → patch → write, so a slow model call between read and write can't revert a concurrent field
 *  (the `patchDream` precedent). Null when the memory is gone. */
export async function patchMemory(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  memoryId: string,
  patch: Partial<Omit<StoryMemory, 'id' | 'personId' | 'schemaVersion' | 'createdAt'>>,
): Promise<StoryMemory | null> {
  const fresh = await getMemory(fs, key, personId, memoryId);
  if (!fresh) return null;
  const next: StoryMemory = { ...fresh, ...patch };
  await saveMemoryRecord(fs, key, next);
  return next;
}

/** A person's memories, newest-updated first (skips a folder with no memory.enc). */
export async function listMemories(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<StoryMemory[]> {
  const out: StoryMemory[] = [];
  for (const name of await fs.list(memoriesDir(personId))) {
    if (name.endsWith('.enc')) continue; // memory ids are folders; skip any stray file
    const memory = await getMemory(fs, key, personId, name);
    if (memory) out.push(memory);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/** Delete a memory — purges its whole folder (record + transcript + attachments) AND its Insight, so a
 *  deleted memory truly forgets: it stops feeding the corpus AND the coach (§14). */
export async function deleteMemory(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  memoryId: string,
): Promise<void> {
  const memory = await getMemory(fs, key, personId, memoryId);
  if (memory?.insightId) await deleteInsight(fs, personId, memory.insightId);
  await fs.remove(memoryDir(personId, memoryId));
}

export async function getMemoryConversation(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  memoryId: string,
): Promise<Conversation | null> {
  const raw = await readEncryptedJson(fs, memoryConversationPath(personId, memoryId), key);
  return raw ? ConversationSchema.parse(raw) : null;
}

export async function saveMemoryConversation(
  fs: FileSystem,
  key: Uint8Array,
  conversation: Conversation,
): Promise<void> {
  await writeEncryptedJson(
    fs,
    memoryConversationPath(conversation.personId, conversation.id),
    conversation,
    key,
  );
}

export type StoreMemoryAttachmentResult =
  | AttachmentRef
  | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE'; message: string };

/** Validate (mime + size) then encrypt + store an image attachment for a memory chat (the Sessions
 *  attachment precedent). The renderer is not the trust boundary — re-checked here. */
export async function storeMemoryAttachment(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  memoryId: string,
  bytes: Uint8Array,
  mime: string,
  dims?: { width?: number; height?: number },
): Promise<StoreMemoryAttachmentResult> {
  if (!isAllowedImageMime(mime)) {
    return { ok: false, reason: 'UNSUPPORTED', message: 'That file isn’t a supported image.' };
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'TOO_LARGE', message: 'That image is too large.' };
  }
  const dir = memoryAttachmentsDir(personId, memoryId);
  if (!isMemoryAttachmentPath(`${dir}/probe.enc`)) {
    return { ok: false, reason: 'UNSUPPORTED', message: 'Invalid memory reference.' };
  }
  const { id, path } = await storeMedia(fs, key, dir, bytes);
  return {
    id,
    kind: 'image',
    mime,
    path,
    bytes: bytes.length,
    ...(dims?.width !== undefined ? { width: dims.width } : {}),
    ...(dims?.height !== undefined ? { height: dims.height } : {}),
  };
}

export async function getMemoryAttachment(
  fs: FileSystem,
  key: Uint8Array,
  path: string,
): Promise<Uint8Array | null> {
  return getMedia(fs, key, path, isMemoryAttachmentPath);
}

// --- The interview chat ----------------------------------------------------------------------------------

const MEMORY_CHAT_MAX_TOKENS = 4096;
const MEMORY_OPENER_MAX_TOKENS = 1024;

/** The private "I have enough to write this memory up" signal — the DREAM_READY precedent. Never shown. */
export const MEMORY_READY_MARKER = '[[SELFOS:MEMORY_READY]]';

/**
 * The biographer's interviewing voice for a shared memory (§14) — a sibling of `DREAM_ANALYSIS_GUIDANCE`,
 * built on the McAdams deepening ladder (the research that never reached the gap pass). One focused question
 * at a time; go for the scene (place → sensory detail → objects → dialogue → how it felt in the body → what
 * it means); NEVER write the memory up in-chat (the app produces that separately). "Sacred carnality": draw
 * out real detail, never invent it.
 */
export const MEMORY_INTERVIEW_GUIDANCE = `You are ${'${name}'}'s biographer, and they want to tell you about a \
memory — a moment from their life. Your job in this conversation is to LISTEN and gently draw the moment out \
in vivid, specific detail, ONE focused question at a time, so it can become part of their book. Follow the \
material they bring; do not interrogate.

Deepen a memory the way a great biographer does — the deepening ladder, in roughly this order as it fits:
- PLACE: where were they? Put them back in the room.
- SENSORY: what did they see, hear, smell? ("what did the kitchen smell like that morning?")
- OBJECTS: the specific things present — a chair, a letter, a car.
- DIALOGUE: what was said, and by whom, in whose words?
- THE BODY: what did it feel like physically, in the moment?
- MEANING: gently, near the end — why does this matter to them? what does it say about who they are or were?

Ask for the concrete and the sensory before the abstract. Favour one good question over a wall of them. Draw \
out real detail; NEVER invent or assume a detail they didn't give — if you're curious about something, ask.

You NEVER write the memory up in this conversation. The written memory is a separate thing the app produces \
and saves — so never summarize it back, never write it out as prose, never present "here's your memory". \
Stay in the exploring register: one question at a time.

When you have enough — the scene, the people, the feeling, and what it means — do not keep going. In one \
short, warm sentence tell them it feels like there's a whole memory here now and invite them to save it, and \
make clear they can keep talking if there's more they want to bring. Then let them choose. If they ask you to \
write it, warmly point them to saving it instead.

This is a warm, reflective conversation, not therapy, diagnosis, or treatment.`;

/** Teaches the coach the readiness-marker convention (appended to chat turns only — never to synthesis). */
export const MEMORY_READY_INSTRUCTION = `On the SAME turn that you invite them to save the memory, append the \
exact token ${MEMORY_READY_MARKER} as the very last thing in your reply, on its own. Pair the two: the spoken \
invitation and this token always go together. It is a silent signal that a memory can now be written; it is \
never shown to the person, so never mention it, explain it, or use it before you genuinely have enough. If \
they still have more to tell, keep exploring and do not include it yet.`;

/** The (non-persisted) instruction that has the coach OPEN the conversation referencing what they're sharing. */
function openerInstruction(seedFocus?: string): string {
  const focus = seedFocus?.trim();
  return focus
    ? `The person wants to tell you about this: "${focus}". Open warmly — acknowledge what they want to share, then ask ONE gentle, specific opening question to begin drawing the moment out (start with where they were, or what they picture first). Do not summarize or write anything up; just warmly begin.`
    : `Open the conversation warmly. In a sentence, invite them to tell you about a memory — a moment from their life, big or small — and ask ONE gentle opening question to get them started (e.g. what's a moment that's been on their mind, or a time they'd want remembered). Do not write anything up; just warmly begin.`;
}

/** A warm, AI-free opener used when the coach can't open (no key / over budget / error). */
function staticOpener(seedFocus?: string): string {
  const focus = seedFocus?.trim();
  return focus
    ? `Let's tell this one properly: "${focus}". Take me back to it — where were you, and what's the first thing you picture?`
    : `I'd love to hear a memory — a moment from your life, big or small. Take me back to one: where were you, and what stands out first?`;
}

/** Strip the readiness marker (and any trailing mid-stream partial) so it never persists or flashes. */
export function stripMemoryMarkers(text: string): string {
  let out = text.split(MEMORY_READY_MARKER).join('');
  for (let i = MEMORY_READY_MARKER.length - 1; i > 0; i--) {
    const partial = MEMORY_READY_MARKER.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}

/** The biographer system prompt for the memory chat: the book's biographer voice (SAFETY leads) + the
 *  memory-interview guidance. Uses the person's default book config where they have a book, else warm/third. */
async function buildMemorySystem(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  name: string,
): Promise<string> {
  const books = await listBooks(fs, key, personId);
  const book = books[0] ?? null;
  const bookType = getBookType(book?.type ?? 'biography') ?? BIOGRAPHY_BOOK_TYPE;
  const config = book?.config ?? {
    voice: 'third',
    style: 'warm',
    length: 'full',
    autoRefresh: true,
  };
  const system = buildBiographerSystem(bookType, config, name);
  const guidance = MEMORY_INTERVIEW_GUIDANCE.replace('${name}', name || 'this person');
  return [system, guidance, FORMATTING].filter(Boolean).join('\n\n');
}

export interface StoryMemoryTurnDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  personName: string;
  memoryId: string;
  userText: string;
  attachments?: AttachmentRef[];
  onDelta: (text: string) => void;
  now: Date;
  override?: boolean;
}
export type StoryMemoryRetryDeps = Omit<StoryMemoryTurnDeps, 'userText' | 'attachments'>;

function buildUsage(
  model: string,
  memoryId: string,
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
    type: 'story.memory',
    personId,
    sessionId: memoryId,
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

/** Re-supply the full history per turn, mapping any attachment-bearing message to vision content blocks
 *  (re-read host-side; a missing/corrupt attachment degrades to the text). The Sessions precedent. */
async function buildMemoryClaudeMessages(
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
      const bytes = await getMemoryAttachment(fs, key, ref.path);
      if (!bytes) continue;
      images.push({
        type: 'image',
        source: { type: 'base64', media_type: ref.mime, data: toBase64(bytes) },
      });
    }
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

export interface StoryMemoryOpenResult {
  ok: true;
  memory: StoryMemory;
  conversation: Conversation;
  usage?: UsageEvent;
}

/**
 * Open (or resume) a memory chat (§14): create the memory record if new, then have the biographer speak first
 * with an opener referencing what they're sharing (idempotent — an already-opened chat resumes with no spend;
 * degrades to a warm static opener with no key / over budget / on error). Metered `story.memory`.
 */
export async function openMemoryChat(deps: {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  personName: string;
  memoryId?: string;
  seedFocus?: string;
  onDelta: (text: string) => void;
  now: Date;
  override?: boolean;
}): Promise<StoryMemoryOpenResult> {
  const { fs, key, client, apiKey, model, personId, personName, now } = deps;
  const at = now.toISOString();
  const memoryId = deps.memoryId ?? uuid();

  const existingMemory = await getMemory(fs, key, personId, memoryId);
  const memory: StoryMemory = existingMemory ?? {
    id: memoryId,
    schemaVersion: 1,
    personId,
    status: 'gathering',
    title: '',
    narrative: '',
    places: [],
    people: [],
    lifeAreas: [],
    pullQuotes: [],
    createdAt: at,
    updatedAt: at,
  };
  if (!existingMemory) await saveMemoryRecord(fs, key, memory);

  const existing = await getMemoryConversation(fs, key, personId, memoryId);
  if (existing && existing.messages.length > 0) {
    return { ok: true, memory, conversation: existing };
  }
  const base: Conversation = existing ?? {
    id: memoryId,
    schemaVersion: 1,
    personId,
    title: 'A memory',
    createdAt: at,
    updatedAt: at,
    messages: [],
  };

  const persist = async (text: string, usage?: UsageEvent): Promise<StoryMemoryOpenResult> => {
    const conversation: Conversation = {
      ...base,
      messages: [{ role: 'assistant', content: text, ts: at }],
      updatedAt: at,
    };
    await saveMemoryConversation(fs, key, conversation);
    return { ok: true, memory, conversation, ...(usage ? { usage } : {}) };
  };

  if (!apiKey) return persist(staticOpener(deps.seedFocus));
  if (await overBudget(fs, key, personId, now, deps.override))
    return persist(staticOpener(deps.seedFocus));

  let result;
  try {
    result = await streamWithContinuation(
      client,
      {
        apiKey,
        model,
        system: await buildMemorySystem(fs, key, personId, personName),
        messages: [{ role: 'user', content: openerInstruction(deps.seedFocus) }],
        maxTokens: MEMORY_OPENER_MAX_TOKENS,
      },
      deps.onDelta,
      { canContinue: async () => !(await overBudget(fs, key, personId, now, deps.override)) },
    );
  } catch {
    return persist(staticOpener(deps.seedFocus));
  }
  const usage = buildUsage(model, memoryId, personId, at, result.usage);
  await recordUsage(fs, key, usage);
  const opener = stripMemoryMarkers(result.text).trim();
  return persist(opener || staticOpener(deps.seedFocus), usage);
}

/** One turn of the memory chat: persist the person's message first (66 §3.2), then stream the reply. */
export async function runMemoryTurn(deps: StoryMemoryTurnDeps): Promise<ChatTurnResult> {
  const { fs, key, apiKey, personId, memoryId, userText, attachments, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const memory = await getMemory(fs, key, personId, memoryId);
  if (!memory) return { ok: false, reason: 'ERROR', message: 'That memory is no longer here.' };
  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }
  const at = now.toISOString();
  const existing = await getMemoryConversation(fs, key, personId, memoryId);
  const conversation: Conversation = existing ?? {
    id: memoryId,
    schemaVersion: 1,
    personId,
    title: 'A memory',
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
  conversation.messages.push({
    role: 'user',
    content: userText,
    ts: at,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  });
  conversation.updatedAt = at;
  await saveMemoryConversation(fs, key, conversation);
  return generateMemoryReply(deps, conversation);
}

async function generateMemoryReply(
  deps: Omit<StoryMemoryTurnDeps, 'userText' | 'attachments'>,
  conversation: Conversation,
): Promise<ChatTurnResult> {
  const { fs, key, client, apiKey, model, personId, personName, memoryId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const at = now.toISOString();
  const system = `${await buildMemorySystem(fs, key, personId, personName)}\n\n${MEMORY_READY_INSTRUCTION}`;
  let result;
  try {
    result = await streamWithContinuation(
      client,
      {
        apiKey,
        model,
        system,
        messages: await buildMemoryClaudeMessages(fs, key, conversation.messages),
        maxTokens: MEMORY_CHAT_MAX_TOKENS,
      },
      deps.onDelta,
      { canContinue: async () => !(await overBudget(fs, key, personId, now, deps.override)) },
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The biographer couldn’t respond. Please try again.',
    };
  }
  const usage = buildUsage(model, memoryId, personId, at, result.usage);
  await recordUsage(fs, key, usage);
  if (result.text.trim() === '') {
    return { ok: false, reason: 'EMPTY', message: 'The reply came back empty — please try again.' };
  }
  const analysisReady = result.text.includes(MEMORY_READY_MARKER);
  if (analysisReady) {
    // Durable — the "ready" offer survives navigating away and back (the DREAM_READY §3.4 lesson).
    const fresh = await getMemory(fs, key, personId, memoryId);
    if (fresh && fresh.status === 'gathering') {
      await patchMemory(fs, key, personId, memoryId, {
        status: 'ready',
        readyAt: at,
        updatedAt: at,
      });
    }
  }
  conversation.messages.push({
    role: 'assistant',
    content: stripMemoryMarkers(result.text),
    ts: at,
  });
  conversation.updatedAt = at;
  await saveMemoryConversation(fs, key, conversation);
  // Auto working title (§14): once there's been an exchange, give an untitled draft a short title so it's
  // identifiable in the "Pick up where you left off" list. Best-effort — a failure never breaks the turn.
  await maybeGenerateWorkingTitle(deps).catch(() => undefined);
  return { ok: true, conversation, usage, ...(analysisReady ? { analysisReady } : {}) };
}

const WORKING_TITLE_INSTRUCTION = `Give this memory a short working title — 2 to 5 evocative words in the \
person's own register. Reply with ONLY the title: no quotation marks, no trailing punctuation, no preamble.`;

/**
 * A cheap AI working title for an in-progress memory (§14) — only while the draft is still UNSAVED
 * (`gathering` OR marker-`ready`-but-not-synthesized) with an empty title and there's been ≥1 exchange, so the
 * resume list can name it before it's synthesized+saved. It re-attempts each turn ONLY while the title is still
 * empty, then stops (the title becoming non-empty is the "run once" mechanism). Metered `story.memory`; a
 * genuinely-empty/failed reply leaves the title empty (the list
 * shows a "New memory" fallback). Re-reads before the write so a concurrent synthesis title is never clobbered.
 */
async function maybeGenerateWorkingTitle(
  deps: Omit<StoryMemoryTurnDeps, 'userText' | 'attachments'>,
): Promise<void> {
  const { fs, key, client, apiKey, model, personId, memoryId, now } = deps;
  if (!apiKey) return;
  const memory = await getMemory(fs, key, personId, memoryId);
  // Any UNSAVED untitled draft — `gathering` OR marker-`ready`-but-not-yet-synthesized (both carry an empty
  // title) — so a memory shared in a single turn (which flips straight to `ready`) still gets a resume label.
  if (!memory || memory.status === 'saved' || memory.title.trim() !== '') return;
  const transcript = await getMemoryConversation(fs, key, personId, memoryId);
  if (!transcript?.messages.some((m) => m.role === 'user')) return;
  if (await overBudget(fs, key, personId, now, deps.override)) return;
  const at = now.toISOString();
  const result = await client.stream(
    {
      apiKey,
      model,
      system: 'You give a personal memory a short, evocative working title in a few words.',
      messages: [
        ...transcript.messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: WORKING_TITLE_INSTRUCTION },
      ],
      maxTokens: 24,
      extendedThinking: false,
    },
    () => {},
  );
  await recordUsage(fs, key, buildUsage(model, memoryId, personId, at, result.usage));
  const title = result.text
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .slice(0, 80)
    .trim();
  if (!title) return;
  // Re-read: only stamp the title if the draft is STILL an untitled, unsaved memory (never clobber a
  // synthesis that set the final title, or a title already generated on a racing turn).
  const fresh = await getMemory(fs, key, personId, memoryId);
  if (fresh && fresh.status !== 'saved' && fresh.title.trim() === '') {
    await patchMemory(fs, key, personId, memoryId, { title, updatedAt: at });
  }
}

/** Re-generate the reply for a transcript ending on an unanswered message (66 §3.2) — after a failed/empty
 *  turn. Adds no user message, so it can never duplicate one. */
export async function retryMemoryReply(deps: StoryMemoryRetryDeps): Promise<ChatTurnResult> {
  const { fs, key, personId, memoryId, now } = deps;
  if (!deps.apiKey)
    return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }
  const conversation = await getMemoryConversation(fs, key, personId, memoryId);
  if (!conversation)
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  while (conversation.messages.length > 0) {
    const tail = conversation.messages[conversation.messages.length - 1];
    if (tail && tail.role === 'assistant' && tail.content.trim() === '')
      conversation.messages.pop();
    else break;
  }
  if (conversation.messages[conversation.messages.length - 1]?.role !== 'user') {
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  }
  return generateMemoryReply(deps, conversation);
}

export async function rewindMemoryConversation(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  memoryId: string,
  index: number,
  expect: MessageStamp,
): Promise<RewindResult> {
  const conversation = await getMemoryConversation(fs, key, personId, memoryId);
  if (!conversation) return { ok: false, reason: 'NOT_FOUND' };
  const result = truncateMessages(conversation.messages, index, expect);
  if (!result.ok) return result;
  // Reap attachments on dropped messages so a rewind never orphans encrypted bytes (the Sessions precedent).
  await reapDroppedAttachments(fs, result.dropped, isMemoryAttachmentPath);
  const trimmed: Conversation = {
    ...conversation,
    messages: result.messages,
    updatedAt: new Date().toISOString(),
  };
  await saveMemoryConversation(fs, key, trimmed);
  return { ok: true, conversation: trimmed };
}

export async function regenerateMemoryFrom(
  deps: StoryMemoryRetryDeps,
  index: number,
  expect: MessageStamp,
): Promise<ChatTurnResult> {
  const { fs, key, personId, memoryId } = deps;
  const conversation = await getMemoryConversation(fs, key, personId, memoryId);
  if (!conversation)
    return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  const target = conversation.messages[index];
  if (!target || target.role !== expect.role || target.ts !== expect.ts) {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'This conversation moved on — reopen it and try again.',
    };
  }
  const at = regenerateIndexFor(conversation.messages, index);
  if (at < conversation.messages.length) {
    const cut = conversation.messages[at];
    if (!cut) return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
    const rewound = await rewindMemoryConversation(fs, key, personId, memoryId, at, {
      role: cut.role,
      ts: cut.ts,
    });
    if (!rewound.ok)
      return { ok: false, reason: 'ERROR', message: 'There’s nothing to retry here.' };
  }
  return retryMemoryReply(deps);
}

// --- Synthesis + save ------------------------------------------------------------------------------------

const SYNTHESIS_INSTRUCTION = `Now capture this memory as structured data for the person's book. Draw ONLY on \
what they told you in this conversation — never invent a detail. Respond with ONLY a single JSON object (no \
markdown fences, no prose outside it) with these keys:
- "title": a short, evocative title for this memory (a few words).
- "narrative": the memory told back in the FIRST PERSON, in the person's own voice ("I…"), as a vivid, \
faithful few-paragraph account built ONLY from what they shared — their words and details, never invented.
- "approxDate": an approximate date or era when derivable ("1994", "my mid-twenties", "the summer after \
college"); omit if truly unknown.
- "places": array of places the memory happened in (strings).
- "people": array of { "name": string } for the people present (their names as the person gave them).
- "lifeAreas": array of the life areas this memory touches (free strings).
- "emotionalTexture": what it felt like — then, and looking back now (string).
- "pullQuotes": array of short verbatim lines worth quoting, in the person's own words (strings; may be empty).
- "scene": if this memory clearly IS one of these life-story scenes, its key, else omit: "highPoint", \
"lowPoint", "turningPoint", "positiveChildhood", "negativeChildhood", "vividAdult", "spiritual", "wisdom".
- "sensitive": true if the memory centres on trauma, abuse, or explicit intimate/sexual content (so it stays \
private); else omit.
- "crisisFlag": true only if they expressed being in acute danger or crisis right now; else omit.`;

const SynthesisDraftSchema = z.object({
  title: z.string().catch(''),
  narrative: z.string().catch(''),
  approxDate: z.string().optional().catch(undefined),
  places: z.array(z.string()).catch([]),
  people: z.array(z.object({ name: z.string().catch('') })).catch([]),
  lifeAreas: z.array(z.string()).catch([]),
  emotionalTexture: z.string().optional().catch(undefined),
  pullQuotes: z.array(z.string()).catch([]),
  scene: z.string().optional().catch(undefined),
  sensitive: z.boolean().optional().catch(undefined),
  crisisFlag: z.boolean().optional().catch(undefined),
});

export interface StoryMemorySynthDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  personName: string;
  memoryId: string;
  now: Date;
  override?: boolean;
}

const SCENE_KEYS = new Set<string>(MCADAMS_SCENES.map((s) => s.key));

/**
 * Synthesize the memory chat into the structured `StoryMemory` draft (§14) — a bounded JSON call
 * (`extendedThinking: false`), metered `story.memory` BEFORE parse. Tolerant parse; a genuinely-empty reply
 * is an honest failure. Persists the draft on the record with `status: 'ready'` (not yet `saved` — the person
 * confirms it with `saveMemory`), so it survives navigation. Ids/scene keys are validated, never trusted raw.
 */
export async function synthesizeMemory(
  deps: StoryMemorySynthDeps,
): Promise<StoryMemorySynthesisResult> {
  const { fs, key, client, apiKey, model, personId, personName, memoryId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const memory = await getMemory(fs, key, personId, memoryId);
  if (!memory) return { ok: false, reason: 'ERROR', message: 'That memory is no longer here.' };
  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }
  const at = now.toISOString();
  const transcript = await getMemoryConversation(fs, key, personId, memoryId);
  const messages: ClaudeMessage[] = [
    ...(await buildMemoryClaudeMessages(fs, key, transcript?.messages ?? [])),
    { role: 'user', content: SYNTHESIS_INSTRUCTION },
  ];
  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: await buildMemorySystem(fs, key, personId, personName),
        messages,
        maxTokens: 4000,
        extendedThinking: false,
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The memory couldn’t be written. Please try again.',
    };
  }
  const usage = buildUsage(model, memoryId, personId, at, result.usage);
  await recordUsage(fs, key, usage);
  const draft = SynthesisDraftSchema.safeParse(extractJsonObject(result.text)).data;
  if (!draft || draft.narrative.trim() === '') {
    const { reason, message } = classifyParseOutcome(result.text, 'memory');
    return { ok: false, reason, message };
  }
  const validArea = new Set<string>(LIFE_AREAS);
  const updated: StoryMemory = {
    ...memory,
    status: 'ready',
    title: draft.title.trim() || 'A memory',
    narrative: draft.narrative.trim(),
    ...(draft.approxDate ? { approxDate: draft.approxDate.trim() } : {}),
    places: draft.places.map((p) => p.trim()).filter(Boolean),
    people: draft.people.map((p) => ({ name: p.name.trim() })).filter((p) => p.name.length > 0),
    lifeAreas: draft.lifeAreas.filter((a) => validArea.has(a)),
    ...(draft.emotionalTexture ? { emotionalTexture: draft.emotionalTexture.trim() } : {}),
    pullQuotes: draft.pullQuotes.map((q) => q.trim()).filter(Boolean),
    ...(draft.scene && SCENE_KEYS.has(draft.scene) ? { scene: draft.scene } : {}),
    ...(draft.sensitive ? { sensitive: true } : {}),
    ...(draft.crisisFlag ? { crisisFlag: true } : {}),
    updatedAt: at,
    ...(memory.readyAt ? {} : { readyAt: at }),
  };
  await saveMemoryRecord(fs, key, updated);
  return { ok: true, memory: updated };
}

/**
 * Commit a synthesized memory (§14, the one-tap confirm) — apply the confirm card's edits, mark it `saved`,
 * and distill it into an `Insight` (`source: 'memory'`) so it feeds the coach / Memory / Together /
 * questionnaire de-dup. A SENSITIVE memory's facts are `restricted` (own-context only, never partner-shared);
 * a normal memory defaults to partner-shared (the standing owner rule via `producedFactShare`). Gated by
 * `memoryEnabled` (the dream precedent) — when memory is off, the memory still SAVES (it feeds the book) but
 * no Insight is written. Re-save updates the same Insight (stable id), carrying sharing forward.
 */
export async function saveMemory(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  memoryId: string;
  edits?: StoryMemoryEdits;
  memoryEnabled: boolean;
  now: Date;
}): Promise<StoryMemorySaveResult> {
  const { fs, key, personId, memoryId, edits, memoryEnabled, now } = deps;
  const memory = await getMemory(fs, key, personId, memoryId);
  if (!memory) return { ok: false, reason: 'ERROR', message: 'That memory is no longer here.' };
  if (memory.status === 'gathering') {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'Finish gathering this memory before saving it.',
    };
  }
  const at = now.toISOString();
  const insightId = memory.insightId ?? uuid();
  const saved: StoryMemory = {
    ...memory,
    ...(edits?.title !== undefined ? { title: edits.title.trim() } : {}),
    ...(edits?.narrative !== undefined ? { narrative: edits.narrative.trim() } : {}),
    ...(edits?.approxDate !== undefined ? { approxDate: edits.approxDate.trim() } : {}),
    ...(edits?.emotionalTexture !== undefined
      ? { emotionalTexture: edits.emotionalTexture.trim() }
      : {}),
    status: 'saved',
    updatedAt: at,
    savedAt: memory.savedAt ?? at,
  };

  if (memoryEnabled) {
    const restricted = saved.sensitive === true;
    const prior = memory.insightId ? await getInsight(fs, key, personId, insightId) : null;
    const priorShares = new Map((prior?.facts ?? []).map((f) => [f.id, f]));
    const facts: InsightFact[] = [];
    const addFact = (suffix: string, text: string, lifeArea?: string): void => {
      if (!text.trim()) return;
      const id = `${insightId}:${suffix}`;
      const carried = priorShares.get(id);
      facts.push({
        id,
        text: text.trim(),
        ...producedFactShare(restricted, carried?.shareableTypes),
        ...(carried?.shareableWith?.length ? { shareableWith: carried.shareableWith } : {}),
        ...(lifeArea ? { lifeArea } : {}),
      });
    };
    // The narrative is the memory; the emotional texture is the felt layer. A sensitive memory tags its facts
    // Intimacy so the restricted-relevance gate keeps them own-context + intimacy-topic only (spec 50/62).
    addFact('memory', saved.narrative, restricted ? 'Intimacy' : saved.lifeAreas[0]);
    if (saved.emotionalTexture)
      addFact('feeling', saved.emotionalTexture, restricted ? 'Intimacy' : undefined);

    const insight: Insight = {
      id: insightId,
      schemaVersion: 1,
      source: 'memory',
      subjectPersonId: personId,
      summary: saved.title || 'A memory',
      facts,
      confidence: 'high', // the person told it directly — their own account
      categories: saved.lifeAreas.length > 0 ? saved.lifeAreas : ['Emotions & patterns'],
      approved: true, // saving IS the explicit approve step (the person confirmed the card)
      provenance: { memoryId, at },
      ...(saved.crisisFlag !== undefined ? { crisisFlag: saved.crisisFlag } : {}),
      createdAt: prior?.createdAt ?? at,
      updatedAt: at,
    };
    await saveInsight(fs, key, insight);
    saved.insightId = insightId;
  }

  await saveMemoryRecord(fs, key, saved);
  return { ok: true, memory: saved };
}

// --- Views (the collection + the "wove into" linkage) ----------------------------------------------------

/**
 * The "Memories you've shared" collection (§14) — every memory newest-first, each joined "wove into <chapter>"
 * where derivable (its Insight is cited by a chapter's paragraph provenance, the answered-check-in precedent).
 * Deterministic, free.
 */
export async function listMemoryViews(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<StoryMemoryView[]> {
  const memories = await listMemories(fs, key, personId);
  // insightId → the first chapter (across all books) whose paragraph provenance cites it.
  const chapterForInsight = new Map<string, string>();
  for (const book of await listBooks(fs, key, personId)) {
    for (const chapter of await listChapters(fs, key, personId, book.id)) {
      for (const entry of chapter.provenance) {
        for (const ref of entry.refs) {
          if (ref.kind === 'insight' && !chapterForInsight.has(ref.id)) {
            chapterForInsight.set(ref.id, chapter.title);
          }
        }
      }
    }
  }
  return memories.map((m) => {
    const chapterTitle = m.insightId ? chapterForInsight.get(m.insightId) : undefined;
    return {
      id: m.id,
      status: m.status,
      // Raw title (may be empty for an untitled in-progress draft) — the renderer shows a "New memory"
      // fallback; the auto working title (§14) fills it once there's an exchange.
      title: m.title,
      ...(m.approxDate ? { approxDate: m.approxDate } : {}),
      people: m.people,
      updatedAt: m.updatedAt,
      ...(chapterTitle ? { wroteIntoChapterTitle: chapterTitle } : {}),
    };
  });
}
