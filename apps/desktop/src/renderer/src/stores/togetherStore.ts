import { create } from 'zustand';
import type {
  Agreement,
  AgreementStatus,
  AgreementSummary,
  AttachmentRef,
  Person,
  TogetherCatalogEntry,
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
  markRead: (id: string) => Promise<void>;
  leave: (id: string) => Promise<void>;
  /** Withdraw a pending invitation (initiator-only, recipient hasn't responded) — deletes it for both. */
  withdraw: (id: string) => Promise<boolean>;
  setPaused: (id: string, paused: boolean) => Promise<void>;
  loadReport: (sessionId: string) => Promise<void>;
  wrapUp: (sessionId: string) => Promise<TogetherWrapUpResult>;
  saveAgreement: (input: {
    sessionId: string;
    id?: string;
    text: string;
    timeframe?: string;
    status: AgreementStatus;
  }) => Promise<Agreement | null>;
  /** Load standing agreements across the active person's pairs (spec 61). */
  loadMyAgreements: () => Promise<void>;
  /** Mark a standing agreement done/retired from Goals/Home (spec 61); refreshes `myAgreements`. */
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
      if (fresh && !get().sending) set({ open: fresh });
    }
  },
  openSession: async (id) => {
    const open = (await window.selfos?.togetherGet(id)) ?? null;
    set({ open, streaming: '', error: null });
    if (open) void window.selfos?.togetherMarkRead({ sessionId: id, at: new Date().toISOString() });
  },
  closeSession: () => set({ open: null, streaming: '', error: null }),
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
          sessionId: open.id,
          base64: p.base64,
          mime: p.mime,
          width: p.width,
          height: p.height,
        });
        if (stored && 'id' in stored) attachments.push(stored);
      }
      const result =
        (await window.selfos?.togetherSendMessage({
          sessionId: open.id,
          text,
          ...(privateAside ? { privateAside: true } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        })) ?? NOT_ALLOWED;
      if (result.ok) {
        set({ open: result.view, sending: false, streaming: '' });
        // A shared (non-aside) turn may have captured an agreement (§6.4) or moved the report's staleness —
        // refresh the ledger/report so it stays live. An aside mints no shared artifacts (§3.6), so skip it.
        if (!privateAside) await get().loadReport(open.id);
      } else set({ sending: false, streaming: '', error: result.message });
      return result;
    } catch {
      set({ sending: false, streaming: '', error: TURN_ERROR.message });
      return TURN_ERROR;
    }
  },
  retry: async () => {
    const open = get().open;
    if (!open) return NOT_ALLOWED;
    set({ sending: true, streaming: '', error: null });
    try {
      const result = (await window.selfos?.togetherRetry({ sessionId: open.id })) ?? NOT_ALLOWED;
      if (result.ok) set({ open: result.view, sending: false, streaming: '' });
      else set({ sending: false, streaming: '', error: result.message });
      return result;
    } catch {
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
  wrapUp: async (sessionId) => {
    set({ wrappingUp: true });
    const result = (await window.selfos?.togetherWrapUp({ sessionId })) ?? WRAP_NOT_READY;
    set({ wrappingUp: false });
    // Refresh the report + the open session (its status may derive to complete).
    await get().loadReport(sessionId);
    if (get().open?.id === sessionId) await get().refresh();
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
  setAgreementStatus: async (partnerPersonId, agreementId, status) => {
    await window.selfos?.togetherSetAgreementStatus({ partnerPersonId, agreementId, status });
    await get().loadMyAgreements();
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
    }),
}));

/** Append a streamed chunk to the open session's live reply text (wired to `onTogetherChunk`). */
export function appendTogetherChunk(delta: string): void {
  useTogetherStore.setState((s) => ({ streaming: s.streaming + delta }));
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
