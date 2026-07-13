import type { FileSystem } from '../host';
import { uuid } from '../id';
import { getMedia, isAllowedImageMime, MAX_IMAGE_BYTES, storeMedia } from '../media';
import {
  ParticipantStateSchema,
  TogetherMessageSchema,
  TogetherSessionSchema,
  type AttachmentRef,
  type ParticipantState,
  type TogetherGuideView,
  type TogetherMessage,
  type TogetherMessageView,
  type TogetherSession,
  type TogetherStatus,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { getTogetherGuide } from './togetherCatalog';

// ── Together session/message/state CRUD + the viewer-projection derivations (58 §5.1) ─────────────
// Storage layout (§4.1):
//   together/sessions/<sessionId>/session.enc            — TogetherSession (initiator, once; immutable)
//   together/sessions/<sessionId>/state/<personId>.enc   — ParticipantState (that person ONLY)
//   together/sessions/<sessionId>/messages/<millis>-<personId>-<uuid>.enc — TogetherMessage (write-once)
// Everything a viewer sees — status, turn, unread, snippet — is derived over THAT viewer's projection
// (§3 intro); nothing is stored twice, so no file ever needs a second writer.

export const INVITE_EXPIRY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A path segment is safe (an id we minted) — defense-in-depth against traversal (the `isMediaPath` habit). */
function isSafeSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

/** The stable pair identity (§4.1) — order-independent, survives edge deletion/re-creation. */
export function pairKeyFor(a: string, b: string): string {
  return [a, b].sort().join('~');
}

const SESSIONS_ROOT = 'together/sessions';

function sessionDir(id: string): string {
  return `${SESSIONS_ROOT}/${id}`;
}
function sessionPath(id: string): string {
  return `${sessionDir(id)}/session.enc`;
}
function stateDir(id: string): string {
  return `${sessionDir(id)}/state`;
}
function statePath(id: string, personId: string): string {
  return `${stateDir(id)}/${personId}.enc`;
}
function messagesDir(id: string): string {
  return `${sessionDir(id)}/messages`;
}

// ── Session record ───────────────────────────────────────────────────────────────────────────────

export async function getSession(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<TogetherSession | null> {
  if (!isSafeSegment(id)) return null;
  const raw = await readEncryptedJson(fs, sessionPath(id), key);
  return raw === null ? null : TogetherSessionSchema.parse(raw);
}

/**
 * Create a session (§3.3): written once by the initiator, then immutable. The initiator's own state is
 * seeded with `rulesAckAt` — starting IS consenting (§4.3 rule 4) — so a session with an un-accepted
 * partner derives `invited`.
 */
export async function createSession(
  fs: FileSystem,
  key: Uint8Array,
  input: { initiatorPersonId: string; participantIds: string[]; topic?: string; guideId?: string },
  now: Date,
): Promise<TogetherSession> {
  const id = uuid();
  const at = now.toISOString();
  const participantIds = [...new Set(input.participantIds)];
  const session: TogetherSession = {
    id,
    schemaVersion: 1,
    pairKey: pairKeyFor(participantIds[0] ?? '', participantIds[1] ?? ''),
    participantIds,
    initiatorPersonId: input.initiatorPersonId,
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.guideId ? { guideId: input.guideId } : {}),
    createdAt: at,
  };
  await writeEncryptedJson(fs, sessionPath(id), session, key);
  await saveState(fs, key, id, {
    schemaVersion: 1,
    personId: input.initiatorPersonId,
    rulesAckAt: at,
    updatedAt: at,
  });
  // A guided couples session (§3.10) opens with the guide's STATIC coach message (no model call) — a shared,
  // non-aside message both partners see once the invitation is accepted.
  const guide = input.guideId ? getTogetherGuide(input.guideId) : undefined;
  if (guide) {
    await appendMessage(fs, key, id, {
      id: uuid(),
      schemaVersion: 1,
      authorPersonId: input.initiatorPersonId,
      role: 'assistant',
      content: guide.openingMessage,
      ts: at,
    });
  }
  return session;
}

/** Sessions the person participates in (§5.1). Scans every session root; a corrupt session.enc is skipped. */
export async function listSessionsForPerson(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<TogetherSession[]> {
  const sessions: TogetherSession[] = [];
  for (const name of await fs.list(SESSIONS_ROOT)) {
    if (!isSafeSegment(name)) continue;
    try {
      const raw = await readEncryptedJson(fs, sessionPath(name), key);
      if (!raw) continue;
      const session = TogetherSessionSchema.parse(raw);
      if (session.participantIds.includes(personId)) sessions.push(session);
    } catch {
      // A corrupt/partial session file is skipped, not fatal (§7 tolerant reads).
    }
  }
  return sessions;
}

/**
 * Reap the shared-root Together data belonging to a now-deleted person (58 §5.6 / §H person-delete reap).
 * The deleted person's OWN per-person Together data (pulse check-ins, YNM opt-ins, prep threads)
 * lives under `people/<id>/` and is already gone with `deletePerson`; what remains in the shared `together/`
 * roots are the session folders they participated in and the pair-scoped agreements/reports. Removes:
 *   - every `together/sessions/<id>/` where the person was a participant, and
 *   - every `together/pairs/<pairKey>/` whose pairKey names the person.
 * Best-effort + tolerant (a corrupt/partial entry is skipped) — cleanup only; the live-edge re-gate already
 * makes any partner-side orphan (e.g. their pulse toward the deleted id) unreadable, so a miss never leaks.
 */
export async function reapTogetherForPerson(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<void> {
  if (!isSafeSegment(personId)) return;
  // Session folders the person participated in.
  for (const name of await fs.list(SESSIONS_ROOT)) {
    if (!isSafeSegment(name)) continue;
    try {
      const raw = await readEncryptedJson(fs, sessionPath(name), key);
      if (!raw) continue;
      const session = TogetherSessionSchema.parse(raw);
      if (session.participantIds.includes(personId)) await fs.remove(sessionDir(name));
    } catch {
      // Skip a corrupt session; never fatal.
    }
  }
  // Pair-scoped agreements/reports whose pairKey names the person (pairKey = sorted a~b).
  const PAIRS_ROOT = 'together/pairs';
  for (const pairKey of await fs.list(PAIRS_ROOT)) {
    const parts = pairKey.split('~');
    // Defense-in-depth: only touch a well-formed pairKey (two safe segments) that names the person —
    // matching the pairKey validation in agreement/pulse/ynm services.
    if (parts.length === 2 && parts.every(isSafeSegment) && parts.includes(personId)) {
      try {
        await fs.remove(`${PAIRS_ROOT}/${pairKey}`);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

/**
 * Whether a session is still a PENDING invitation — a non-initiator participant has not acked the ceremony,
 * so it hasn't become a live session yet (mirrors `deriveStatusFor`'s `invited`/`expired`, where the
 * initiator acks at create). A quiet decline leaves the recipient un-acked, so a declined invite is still
 * "pending" here — the initiator can withdraw it too.
 */
export function isPendingInvite(
  session: TogetherSession,
  states: Map<string, ParticipantState>,
): boolean {
  if ([...states.values()].some((s) => s.leftAt)) return false; // a formally-left session isn't a pending invite
  return !session.participantIds.every((pid) => states.get(pid)?.rulesAckAt);
}

/** The outcome of a withdraw attempt — a typed reason so the caller can surface an honest message (§7). */
export type WithdrawResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_INITIATOR' | 'ALREADY_ACCEPTED' };

/**
 * Withdraw (undo) a Together invitation the recipient hasn't responded to yet (58 §3.4). ONLY the initiator
 * may withdraw, and ONLY while it's still a pending invite (`isPendingInvite`). Deletes the shared session
 * folder outright, so it vanishes for BOTH people — as if never sent. The bridge is the trust boundary
 * (participant + live-edge gating); this enforces the initiator-only + pending-only invariants host-side.
 */
export async function withdrawSession(
  fs: FileSystem,
  key: Uint8Array,
  sessionId: string,
  byPersonId: string,
): Promise<WithdrawResult> {
  if (!isSafeSegment(sessionId)) return { ok: false, reason: 'NOT_FOUND' };
  const session = await getSession(fs, key, sessionId);
  if (!session) return { ok: false, reason: 'NOT_FOUND' };
  if (session.initiatorPersonId !== byPersonId) return { ok: false, reason: 'NOT_INITIATOR' };
  const states = await listStates(fs, key, sessionId);
  if (!isPendingInvite(session, states)) return { ok: false, reason: 'ALREADY_ACCEPTED' };
  await fs.remove(sessionDir(sessionId));
  return { ok: true };
}

// ── Participant state (one writer per file) ───────────────────────────────────────────────────────

/**
 * All participants' state, keyed by personId. A corrupt state file is treated as ABSENT — fail-closed:
 * an unreadable state means "not consented" (no join, no projection widening), never a silent grant (§7).
 */
export async function listStates(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<Map<string, ParticipantState>> {
  const states = new Map<string, ParticipantState>();
  if (!isSafeSegment(id)) return states;
  for (const name of await fs.list(stateDir(id))) {
    if (!name.endsWith('.enc')) continue;
    try {
      const raw = await readEncryptedJson(fs, `${stateDir(id)}/${name}`, key);
      if (!raw) continue;
      const state = ParticipantStateSchema.parse(raw);
      states.set(state.personId, state);
    } catch {
      // Corrupt state ⇒ that person is treated as having none (fail-closed: not consented).
    }
  }
  return states;
}

export async function getState(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
  personId: string,
): Promise<ParticipantState | null> {
  if (!isSafeSegment(id) || !isSafeSegment(personId)) return null;
  const raw = await readEncryptedJson(fs, statePath(id, personId), key);
  return raw === null ? null : ParticipantStateSchema.parse(raw);
}

export async function saveState(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
  state: ParticipantState,
): Promise<void> {
  await writeEncryptedJson(fs, statePath(id, state.personId), state, key);
}

/**
 * Read-modify-write a person's OWN state (one writer). Returns the persisted state. `now` stamps
 * `updatedAt`; the patch fields (rulesAckAt/declinedAt/pausedAt/leftAt/lastReadMessageAt) are set as given.
 */
export async function updateState(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
  personId: string,
  patch: Partial<Omit<ParticipantState, 'schemaVersion' | 'personId' | 'updatedAt'>>,
  now: Date,
): Promise<ParticipantState> {
  const existing = await getState(fs, key, id, personId);
  const next: ParticipantState = {
    schemaVersion: 1,
    personId,
    ...(existing ?? {}),
    ...patch,
    updatedAt: now.toISOString(),
  };
  await saveState(fs, key, id, next);
  return next;
}

// ── Messages (write-once) ─────────────────────────────────────────────────────────────────────────

/** All messages, oldest→newest by `ts`. A corrupt message file is skipped (§7) rather than fatal. */
export async function listMessages(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<TogetherMessage[]> {
  const messages: TogetherMessage[] = [];
  if (!isSafeSegment(id)) return messages;
  for (const name of await fs.list(messagesDir(id))) {
    if (!name.endsWith('.enc')) continue;
    try {
      const raw = await readEncryptedJson(fs, `${messagesDir(id)}/${name}`, key);
      if (raw) messages.push(TogetherMessageSchema.parse(raw));
    } catch {
      // Skip a corrupt message; the thread renders a notice (§7) but never fails to load.
    }
  }
  return messages.sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * Append a message write-once (§4.1) — the filename `<millis>-<personId>-<uuid>.enc` keeps a natural
 * lexical order and guarantees no two writers ever target the same file (so no sync conflict copies).
 */
export async function appendMessage(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
  message: TogetherMessage,
): Promise<TogetherMessage> {
  const millis = String(Date.parse(message.ts) || Date.now()).padStart(15, '0');
  const seg = isSafeSegment(message.authorPersonId) ? message.authorPersonId : 'x';
  const file = `${messagesDir(id)}/${millis}-${seg}-${uuid()}.enc`;
  await writeEncryptedJson(fs, file, message, key);
  return message;
}

// ── Attachments (58 §6.1) — Together's OWN seam (the 45 solo channels are person-scoped by construction) ──

/** The session's encrypted image-attachment folder (§4.1). */
export function togetherAttachmentsDir(sessionId: string): string {
  return `${sessionDir(sessionId)}/attachments`;
}

/** Guard: a path is one of OUR Together attachment files — defense in depth for `getMedia` (the `isMediaPath` habit). */
export function isTogetherAttachmentPath(path: string): boolean {
  return /^together\/sessions\/[^/]+\/attachments\/[^/]+\.enc$/.test(path) && !path.includes('..');
}

export type StoreTogetherAttachmentResult =
  | AttachmentRef
  | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE'; message: string };

/**
 * Validate (mime + size) then encrypt + store an image attachment under the session's attachments folder.
 * The renderer is NOT the trust boundary — mime/size are re-checked here (the 45 §5.2 pattern).
 */
export async function storeTogetherAttachment(
  fs: FileSystem,
  key: Uint8Array,
  sessionId: string,
  bytes: Uint8Array,
  mime: string,
  dims?: { width?: number; height?: number },
): Promise<StoreTogetherAttachmentResult> {
  if (!isAllowedImageMime(mime)) {
    return { ok: false, reason: 'UNSUPPORTED', message: 'That file isn’t a supported image.' };
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'TOO_LARGE', message: 'That image is too large.' };
  }
  const dir = togetherAttachmentsDir(sessionId);
  if (!isSafeSegment(sessionId) || !isTogetherAttachmentPath(`${dir}/probe.enc`)) {
    return { ok: false, reason: 'UNSUPPORTED', message: 'Invalid session reference.' };
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

/** Read + decrypt a stored Together attachment's bytes; null if out-of-bounds/absent/unreadable. Message-gating
 *  (an aside's attachment is author-only) is enforced by the BRIDGE before calling this (§5.2). */
export async function getTogetherAttachment(
  fs: FileSystem,
  key: Uint8Array,
  path: string,
): Promise<Uint8Array | null> {
  return getMedia(fs, key, path, isTogetherAttachmentPath);
}

/** The message that references an attachment `path` (for the bridge's aside-gated read), or null. */
export async function messageOwningAttachment(
  fs: FileSystem,
  key: Uint8Array,
  sessionId: string,
  path: string,
): Promise<TogetherMessage | null> {
  for (const m of await listMessages(fs, key, sessionId)) {
    if (m.attachments?.some((a) => a.path === path)) return m;
  }
  return null;
}

// ── Derivations (§4.3 / §5.2) — all viewer-relative, none stored ───────────────────────────────────

export function isInvitationExpired(createdAt: string, now: Date): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return now.getTime() - created > INVITE_EXPIRY_DAYS * DAY_MS;
}

/**
 * The DERIVED current step of a structured guided couples session (§3.10) — the `guideStep` of the newest coach
 * message that declared one, else 0. Never stored on the single-writer session.enc; recomputed per read.
 */
export function guideStepFor(messages: TogetherMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant' && m.guideStep !== undefined) return m.guideStep;
  }
  return 0;
}

/** The renderer-facing guide meta for a session's `guideId` (§3.10), or undefined for a free session. */
export function togetherGuideView(guideId: string | undefined): TogetherGuideView | undefined {
  if (!guideId) return undefined;
  const guide = getTogetherGuide(guideId);
  if (!guide) return undefined;
  return {
    id: guide.id,
    title: guide.title,
    framework: guide.framework,
    kind: guide.kind,
    ...(guide.steps ? { steps: guide.steps } : {}),
    ...(guide.adult ? { adult: true } : {}),
  };
}

/** The newest mutually-visible (non-aside) human message ts — the shared report's staleness clock (§3.8). */
function newestSharedHumanTs(messages: TogetherMessage[]): string | null {
  let newest: string | null = null;
  for (const m of messages) {
    if (m.role === 'user' && !m.privateAside) {
      if (newest === null || m.ts > newest) newest = m.ts;
    }
  }
  return newest;
}

/**
 * The viewer-projected status (§4.3). Order is load-bearing. `reportCreatedAt` is null until a wrap-up
 * report exists (Phase D); with it, a session with no newer shared human message derives `complete`.
 */
export function deriveStatusFor(
  session: TogetherSession,
  states: Map<string, ParticipantState>,
  reportCreatedAt: string | null,
  messages: TogetherMessage[],
  viewerId: string,
  now: Date,
): TogetherStatus {
  const vState = states.get(viewerId);
  // 1. The viewer declined — drop the session from their world entirely (caller omits it).
  if (vState?.declinedAt) return 'declined';
  // 2. Anyone left — a neutral terminal `ended` for everyone (§8.3).
  for (const s of states.values()) if (s.leftAt) return 'ended';
  // 3. A FOREIGN declinedAt is ignored (never checked here) → a quiet decline never surfaces (§3.5).
  // 4. Any participant still un-acked → invited (older than 30d → expired). Initiator acks at create.
  const allAcked = session.participantIds.every((pid) => states.get(pid)?.rulesAckAt);
  if (!allAcked) return isInvitationExpired(session.createdAt, now) ? 'expired' : 'invited';
  // 5. A report with no newer shared human message → complete (staleness derived, §3.8).
  if (reportCreatedAt) {
    const newest = newestSharedHumanTs(messages);
    if (!newest || newest <= reportCreatedAt) return 'complete';
  }
  // 6. The viewer paused for themselves — onHold in their view only (§8.3).
  if (vState?.pausedAt) return 'onHold';
  // 7. Otherwise, active.
  return 'active';
}

/** The viewer's projected messages (§5.2): a private aside (and its coach reply) shows only to its author. */
export function projectMessages(
  messages: TogetherMessage[],
  viewerId: string,
): TogetherMessageView[] {
  const visible = messages.filter((m) => !m.privateAside || m.authorPersonId === viewerId);
  const visibleIds = new Set(visible.map((m) => m.id));
  return visible.map((m) => {
    const view: TogetherMessageView = {
      id: m.id,
      authorPersonId: m.authorPersonId,
      role: m.role,
      content: m.content,
      ts: m.ts,
      privateAside: m.privateAside === true,
      ...(m.attachments ? { attachments: m.attachments } : {}),
    };
    // A replyToMessageId is dropped if its target isn't in this projection — it must never dangle across a
    // masking projection (§3.6). Coach aside-replies are themselves asides, so this only fires defensively.
    if (m.replyToMessageId && visibleIds.has(m.replyToMessageId)) {
      view.replyToMessageId = m.replyToMessageId;
    }
    return view;
  });
}

/** "Your turn" (§3.6): the newest human message in the viewer's projection isn't theirs. A nudge, not a lock. */
export function turnStateFor(messages: TogetherMessage[], viewerId: string): boolean {
  const projected = projectMessages(messages, viewerId).filter((m) => m.role === 'user');
  const newest = projected[projected.length - 1];
  return newest ? newest.authorPersonId !== viewerId : false;
}

/** Unread (§3.11): projected messages not authored by the viewer, newer than their `lastReadMessageAt`. */
export function unreadCountFor(
  messages: TogetherMessage[],
  viewerId: string,
  lastReadMessageAt: string | undefined,
): number {
  return projectMessages(messages, viewerId).filter(
    (m) => m.authorPersonId !== viewerId && (!lastReadMessageAt || m.ts > lastReadMessageAt),
  ).length;
}

/** Everything a viewer's list/badge needs, derived once over their projection. */
export interface SessionDigest {
  status: TogetherStatus;
  yourTurn: boolean;
  unreadCount: number;
  viewerAcked: boolean;
  lastMessageSnippet?: string;
  lastMessageAt?: string;
  /** The ts of the newest PRIVATE coach note for this viewer (§3.14 Part B) — drives `together-private`. */
  lastPrivateCoachAt?: string;
}

const SNIPPET_MAX = 140;

export function digestFor(
  session: TogetherSession,
  states: Map<string, ParticipantState>,
  reportCreatedAt: string | null,
  messages: TogetherMessage[],
  viewerId: string,
  now: Date,
): SessionDigest {
  const status = deriveStatusFor(session, states, reportCreatedAt, messages, viewerId, now);
  const projected = projectMessages(messages, viewerId);
  const last = projected[projected.length - 1];
  const vState = states.get(viewerId);
  // The newest coach-INITIATED private note for this viewer (§3.14 Part B) — keyed on `coachInitiated` so it
  // fires ONLY for an unprompted note, NOT for an ordinary §3.6 aside coach REPLY (both are assistant +
  // privateAside + authored-for-viewer). Scoped to the viewer via `authorPersonId` (the projection rule).
  const lastPrivateCoach = [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === 'assistant' &&
        m.privateAside &&
        m.coachInitiated &&
        m.authorPersonId === viewerId,
    );
  return {
    status,
    yourTurn: turnStateFor(messages, viewerId),
    unreadCount: unreadCountFor(messages, viewerId, vState?.lastReadMessageAt),
    viewerAcked: Boolean(vState?.rulesAckAt),
    ...(last
      ? {
          lastMessageSnippet: last.content.slice(0, SNIPPET_MAX),
          lastMessageAt: last.ts,
        }
      : {}),
    ...(lastPrivateCoach ? { lastPrivateCoachAt: lastPrivateCoach.ts } : {}),
  };
}
