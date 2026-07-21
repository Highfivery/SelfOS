import { create } from 'zustand';
import type {
  Agreement,
  AgreementStatus,
  AgreementSummary,
  AttachmentRef,
  Person,
  TogetherCatalogEntry,
  TogetherChunk,
  TogetherCreateResult,
  TogetherMessageView,
  TogetherReportView,
  TogetherSessionSummary,
  TogetherSessionView,
  TogetherTurnResult,
  TogetherWrapUpResult,
} from '@shared/schemas';
import type { PendingAttachment } from '../app/routes/sessions/downscaleImage';
import { useSessionStore } from './sessionStore';

const EMPTY_REPORT: TogetherReportView = { report: null, stale: false, agreements: [] };
const WRAP_NOT_READY: TogetherWrapUpResult = {
  ok: false,
  reason: 'NOT_ALLOWED',
  message: 'Together isn’t available right now.',
};

/** A partner the active person can start a session with (or a disabled non-subject contact — §3.1). */
export interface TogetherPartner {
  personId: string;
  displayName: string;
  /** A subject WITH an account can participate; a non-subject contact is shown disabled with an explainer. */
  eligible: boolean;
}

const NOT_ALLOWED: TogetherTurnResult = {
  ok: false,
  reason: 'NOT_ALLOWED',
  message: 'Together isn’t available right now.',
};
// A THROWN turn (main-process error / dropped IPC) must never leave "thinking" stuck forever — resolve to an
// honest error the user can retry (05 §4.1). The optimistic bubble stays so the just-typed message isn't lost.
const TURN_ERROR: TogetherTurnResult = {
  ok: false,
  reason: 'ERROR',
  message: 'Something went wrong sending that. Try again.',
};

interface TogetherState {
  loaded: boolean;
  /** Whether the active person has ≥1 live `partner` edge — the nav/surface visibility signal (§3.1). */
  hasPartner: boolean;
  partners: TogetherPartner[];
  sessions: TogetherSessionSummary[];
  open: TogetherSessionView | null;
  /** The live streaming reply text for the open session (empty when not streaming). */
  streaming: string;
  sending: boolean;
  error: string | null;
  /** The couples guided catalog cards the active person may start (§3.10); 18+ withheld host-side. */
  catalog: TogetherCatalogEntry[];
  /** The open session's wrap-up report + derived staleness + the pair agreements ledger (§3.8/§3.9). */
  reportView: TogetherReportView;
  /** True while a wrap-up analyze pass is running (the initiator-billed spend). */
  wrappingUp: boolean;
  /** Standing agreements across ALL the active person's pairs (spec 61) — Goals + Home surfaces. */
  myAgreements: AgreementSummary[];
  /** Completed (done) commitments across the active person's pairs — the Goals "Completed & closed" record. */
  myDoneAgreements: AgreementSummary[];

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  closeSession: () => void;
  create: (
    partnerPersonId: string,
    topic?: string,
    guideId?: string,
  ) => Promise<TogetherCreateResult>;
  loadCatalog: () => Promise<void>;
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  sendMessage: (
    text: string,
    privateAside?: boolean,
    pending?: PendingAttachment[],
  ) => Promise<TogetherTurnResult>;
  retry: () => Promise<TogetherTurnResult>;
  /** "Delete from here" — remove this message and everything after it, leaving a tombstone (66 §3.3). */
  rewind: (fromMessageId: string) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  leave: (id: string) => Promise<void>;
  /** Withdraw a pending invitation (initiator-only, recipient hasn't responded) — deletes it for both. */
  withdraw: (id: string) => Promise<boolean>;
  setPaused: (id: string, paused: boolean) => Promise<void>;
  loadReport: (sessionId: string) => Promise<void>;
  /**
   * Analyze the session (spec 58 §3.8): `'reflect'` is a mid-session checkpoint (creates the reflection +
   * deduped action items, session stays open); `'wrapUp'` (default) also marks the session done. Both refresh.
   */
  wrapUp: (sessionId: string, mode?: 'reflect' | 'wrapUp') => Promise<TogetherWrapUpResult>;
  saveAgreement: (input: {
    sessionId: string;
    id?: string;
    text: string;
    timeframe?: string;
    status: AgreementStatus;
  }) => Promise<Agreement | null>;
  /** Load standing agreements across the active person's pairs (spec 61). */
  loadMyAgreements: () => Promise<void>;
  /** Load completed (done) commitments across the active person's pairs (spec 61). */
  loadDoneAgreements: () => Promise<void>;
  /** Set a commitment's status from Goals/Home (spec 61); refreshes BOTH the standing + completed lists so a
   *  mark-done / reopen moves it between them. */
  setAgreementStatus: (
    partnerPersonId: string,
    agreementId: string,
    status: AgreementStatus,
  ) => Promise<void>;
  reset: () => void;
}

const activePersonId = (): string | null => useSessionStore.getState().activePerson?.id ?? null;

/** Derive the partner picker + `hasPartner` from the live relationship graph (§3.1). */
async function resolvePartners(): Promise<{ hasPartner: boolean; partners: TogetherPartner[] }> {
  const me = activePersonId();
  const bridge = window.selfos;
  if (!me || !bridge) return { hasPartner: false, partners: [] };
  const [relationships, people, access] = await Promise.all([
    bridge.relationshipsList(),
    bridge.peopleList(),
    bridge.accessGet(),
  ]);
  const byId = new Map<string, Person>(people.map((p) => [p.id, p]));
  const hasAccount = new Set(access.accounts.map((a) => a.personId));
  const partnerIds = new Set<string>();
  for (const edge of relationships) {
    if (edge.type !== 'partner') continue;
    if (edge.fromPersonId === me) partnerIds.add(edge.toPersonId);
    else if (edge.toPersonId === me) partnerIds.add(edge.fromPersonId);
  }
  const partners: TogetherPartner[] = [...partnerIds].map((id) => {
    const person = byId.get(id);
    return {
      personId: id,
      displayName: person?.displayName ?? 'Someone',
      eligible: Boolean(person?.isSubject && hasAccount.has(id)),
    };
  });
  return { hasPartner: partners.length > 0, partners };
}

export const useTogetherStore = create<TogetherState>((set, get) => ({
  loaded: false,
  hasPartner: false,
  partners: [],
  sessions: [],
  open: null,
  streaming: '',
  sending: false,
  error: null,
  catalog: [],
  reportView: EMPTY_REPORT,
  wrappingUp: false,
  myAgreements: [],
  myDoneAgreements: [],

  load: async () => {
    const [{ hasPartner, partners }, sessions] = await Promise.all([
      resolvePartners(),
      window.selfos?.togetherList() ?? Promise.resolve([]),
    ]);
    set({ loaded: true, hasPartner, partners, sessions });
  },
  refresh: async () => {
    const [{ hasPartner, partners }, sessions] = await Promise.all([
      resolvePartners(),
      window.selfos?.togetherList() ?? Promise.resolve([]),
    ]);
    set({ hasPartner, partners, sessions });
    const open = get().open;
    if (open && !get().sending) {
      const fresh = (await window.selfos?.togetherGet(open.id)) ?? null;
      // Re-check the session is STILL open (and not now sending): the vault-watcher debounce means the
      // user can navigate away during the `togetherGet` await, and writing `fresh` (session A) would
      // clobber whatever they've since opened — the same cross-session clobber `sendMessage` guards.
      if (fresh && get().open?.id === open.id && !get().sending) set({ open: fresh });
    }
  },
  openSession: async (id) => {
    const open = (await window.selfos?.togetherGet(id)) ?? null;
    // Reset the per-session view state too: a freshly opened session is never mid-send/mid-wrap-up from the
    // viewer's standpoint, and another session's in-flight turn must not leave this one showing "thinking" /
    // a disabled composer / stray streamed text (the global streaming state doesn't belong to it).
    // `reportView` is cleared in `closeSession` (the effect cleanup runs BEFORE this) — resetting it here
    // would race the mount-time `loadReport(id)` that runs alongside this open.
    set({ open, streaming: '', sending: false, wrappingUp: false, error: null });
    if (open) void window.selfos?.togetherMarkRead({ sessionId: id, at: new Date().toISOString() });
  },
  closeSession: () =>
    set({
      open: null,
      streaming: '',
      sending: false,
      wrappingUp: false,
      reportView: EMPTY_REPORT,
      error: null,
    }),
  create: async (partnerPersonId, topic, guideId) => {
    const result = (await window.selfos?.togetherCreate({
      partnerPersonId,
      ...(topic && topic.trim() ? { topic: topic.trim() } : {}),
      ...(guideId ? { guideId } : {}),
    })) ?? { ok: false as const, reason: 'NOT_READY' as const, message: 'SelfOS isn’t ready.' };
    if (result.ok) {
      set({ open: result.session });
      await get().refresh();
    }
    return result;
  },
  loadCatalog: async () => {
    const catalog = (await window.selfos?.togetherCatalog()) ?? [];
    set({ catalog });
  },
  accept: async (id) => {
    const view = (await window.selfos?.togetherAccept(id)) ?? null;
    if (view) set({ open: view });
    await get().refresh();
  },
  decline: async (id) => {
    await window.selfos?.togetherDecline(id);
    if (get().open?.id === id) set({ open: null });
    await get().refresh();
  },
  sendMessage: async (text, privateAside, pending) => {
    const open = get().open;
    if (!open) return NOT_ALLOWED;
    // The turn runs against THIS session; the user may navigate to another while the coach is thinking.
    const sessionId = open.id;
    // Show the author's message IMMEDIATELY (so it's clear it was sent) rather than waiting for the coach to
    // finish — the couples turn persists the author's message first (05 §4.1), so this optimistic bubble matches
    // what's on disk; on success `result.view` replaces it, on failure it stays (with the error + Try again).
    const meId = activePersonId();
    const optimistic: TogetherMessageView = {
      id: `pending-${new Date().toISOString()}`,
      authorPersonId: meId ?? open.participants[0]?.personId ?? '',
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
      privateAside: privateAside === true,
    };
    set({
      open: { ...open, messages: [...open.messages, optimistic] },
      sending: true,
      streaming: '',
      error: null,
    });
    try {
      // Store any pending images under the session's own attachment folder (§6.1), then send their refs. A
      // failed store drops that image but the message still sends (best-effort, matching the 45 solo path).
      const attachments: AttachmentRef[] = [];
      for (const p of pending ?? []) {
        const stored = await window.selfos?.togetherStoreAttachment({
          sessionId,
          base64: p.base64,
          mime: p.mime,
          width: p.width,
          height: p.height,
        });
        if (stored && 'id' in stored) attachments.push(stored);
      }
      const result =
        (await window.selfos?.togetherSendMessage({
          sessionId,
          text,
          ...(privateAside ? { privateAside: true } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        })) ?? NOT_ALLOWED;
      // If the user navigated to another session while the coach was thinking, do NOT write this turn's
      // result into the shared view state — that would yank them back to this session (the view renders
      // from `open`, not the URL). The turn is persisted regardless; reopening this session shows it.
      if (get().open?.id !== sessionId) return result;
      if (result.ok) {
        set({ open: result.view, sending: false, streaming: '' });
        // A shared (non-aside) turn may have captured an agreement (§6.4) or moved the report's staleness —
        // refresh the ledger/report so it stays live. An aside mints no shared artifacts (§3.6), so skip it.
        if (!privateAside) await get().loadReport(sessionId);
      } else set({ sending: false, streaming: '', error: result.message });
      return result;
    } catch {
      if (get().open?.id === sessionId)
        set({ sending: false, streaming: '', error: TURN_ERROR.message });
      return TURN_ERROR;
    }
  },
  rewind: async (fromMessageId) => {
    // 66 §3.3 — remove this message and everything after it IN THIS VIEWER'S PROJECTION, leaving a
    // tombstone both partners see. Core owns the span + privacy rules; the store just refreshes.
    const open = get().open;
    if (!open || get().sending) return;
    const sessionId = open.id;
    const view = await window.selfos?.togetherRewind({
      sessionId,
      fromMessageId,
    });
    // Don't apply to another session the user may have navigated to during the await.
    if (get().open?.id !== sessionId) return;
    if (view) set({ open: view, error: null });
    else set({ error: 'Couldn’t remove those messages.' });
  },
  retry: async () => {
    const open = get().open;
    if (!open) return NOT_ALLOWED;
    const sessionId = open.id;
    set({ sending: true, streaming: '', error: null });
    try {
      const result = (await window.selfos?.togetherRetry({ sessionId })) ?? NOT_ALLOWED;
      // As with sendMessage: don't clobber the view if the user has moved to another session mid-turn.
      if (get().open?.id !== sessionId) return result;
      if (result.ok) set({ open: result.view, sending: false, streaming: '' });
      else set({ sending: false, streaming: '', error: result.message });
      return result;
    } catch {
      if (get().open?.id === sessionId)
        set({ sending: false, streaming: '', error: TURN_ERROR.message });
      return TURN_ERROR;
    }
  },
  markRead: async (id) => {
    await window.selfos?.togetherMarkRead({ sessionId: id, at: new Date().toISOString() });
  },
  leave: async (id) => {
    const view = (await window.selfos?.togetherLeave(id)) ?? null;
    if (view && get().open?.id === id) set({ open: view });
    await get().refresh();
  },
  withdraw: async (id) => {
    const ok = (await window.selfos?.togetherWithdraw(id)) ?? false;
    if (ok && get().open?.id === id) set({ open: null });
    await get().refresh();
    return ok;
  },
  setPaused: async (id, paused) => {
    const view = (await window.selfos?.togetherSetPaused({ sessionId: id, paused })) ?? null;
    if (view && get().open?.id === id) set({ open: view });
    await get().refresh();
  },
  loadReport: async (sessionId) => {
    const reportView = (await window.selfos?.togetherGetReport({ sessionId })) ?? EMPTY_REPORT;
    set({ reportView });
  },
  wrapUp: async (sessionId, mode) => {
    set({ wrappingUp: true });
    const result =
      (await window.selfos?.togetherWrapUp({ sessionId, ...(mode ? { mode } : {}) })) ??
      WRAP_NOT_READY;
    set({ wrappingUp: false });
    // Refresh the report + the open session (its status may derive to complete) — but only if the viewer is
    // STILL on this session: a wrap-up is a multi-second pass, and refreshing A's report into the shared
    // `reportView` while they're now on B would show A's reflection/agreements under B.
    if (get().open?.id === sessionId) {
      await get().loadReport(sessionId);
      await get().refresh();
    }
    return result;
  },
  saveAgreement: async (input) => {
    const agreement = (await window.selfos?.togetherSaveAgreement(input)) ?? null;
    await get().loadReport(input.sessionId);
    await get().loadMyAgreements();
    return agreement;
  },
  loadMyAgreements: async () => {
    const myAgreements = (await window.selfos?.togetherMyAgreements()) ?? [];
    set({ myAgreements });
  },
  loadDoneAgreements: async () => {
    const myDoneAgreements = (await window.selfos?.togetherDoneCommitments()) ?? [];
    set({ myDoneAgreements });
  },
  setAgreementStatus: async (partnerPersonId, agreementId, status) => {
    await window.selfos?.togetherSetAgreementStatus({ partnerPersonId, agreementId, status });
    // Refresh BOTH lists so the commitment moves between standing ⇄ completed (mark-done / reopen).
    await Promise.all([get().loadMyAgreements(), get().loadDoneAgreements()]);
  },
  reset: () =>
    set({
      loaded: false,
      hasPartner: false,
      partners: [],
      sessions: [],
      open: null,
      streaming: '',
      sending: false,
      error: null,
      catalog: [],
      reportView: EMPTY_REPORT,
      wrappingUp: false,
      myAgreements: [],
      myDoneAgreements: [],
    }),
}));

/**
 * Append a streamed chunk to the open session's live reply text (wired to `onTogetherChunk`).
 *
 * Each chunk is tagged with the session it belongs to (§3.6), so a delta is applied ONLY when it's for the
 * session currently open AND that session is actively sending. A turn still streaming in the main process
 * after the viewer navigated to another session (or a concurrent turn in a different session) is dropped
 * rather than bleeding into whatever session's live bubble is on screen.
 */
export function appendTogetherChunk(chunk: TogetherChunk): void {
  useTogetherStore.setState((s) =>
    s.sending && s.open?.id === chunk.sessionId ? { streaming: s.streaming + chunk.delta } : {},
  );
}

/**
 * The count of sessions "waiting on you" — invitations you RECEIVED + your-turn sessions — for the nav badge
 * (§3.1). An `invited` session the ACTIVE person initiated is their own pending outgoing invite (they're
 * waiting on the partner, not the other way round), so it's excluded.
 */
export function togetherWaitingCount(
  sessions: TogetherSessionSummary[],
  myId: string | null,
): number {
  return sessions.filter(
    (s) =>
      (s.status === 'invited' && s.initiatorPersonId !== myId) ||
      (s.status === 'active' && s.yourTurn),
  ).length;
}
