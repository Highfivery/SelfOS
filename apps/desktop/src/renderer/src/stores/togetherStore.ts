import { create } from 'zustand';
import type {
  Agreement,
  AgreementStatus,
  AttachmentRef,
  Person,
  TogetherCatalogEntry,
  TogetherCreateResult,
  TogetherPreScreenResult,
  TogetherPreScreenView,
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
const HELD_PRESCREEN: TogetherPreScreenResult = {
  flagged: true,
  showCrisis: false,
  suggestSolo: true,
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
  prescreen: TogetherPreScreenView | null;
  /** The couples guided catalog cards the active person may start (§3.10); 18+ withheld host-side. */
  catalog: TogetherCatalogEntry[];
  /** The open session's wrap-up report + derived staleness + the pair agreements ledger (§3.8/§3.9). */
  reportView: TogetherReportView;
  /** True while a wrap-up analyze pass is running (the initiator-billed spend). */
  wrappingUp: boolean;

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
  setPaused: (id: string, paused: boolean) => Promise<void>;
  loadPrescreen: () => Promise<void>;
  submitPrescreen: (answers: Record<string, string>) => Promise<TogetherPreScreenResult>;
  loadReport: (sessionId: string) => Promise<void>;
  wrapUp: (sessionId: string) => Promise<TogetherWrapUpResult>;
  saveAgreement: (input: {
    sessionId: string;
    id?: string;
    text: string;
    timeframe?: string;
    status: AgreementStatus;
  }) => Promise<Agreement | null>;
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
  prescreen: null,
  catalog: [],
  reportView: EMPTY_REPORT,
  wrappingUp: false,

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
    set({ sending: true, streaming: '', error: null });
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
  },
  retry: async () => {
    const open = get().open;
    if (!open) return NOT_ALLOWED;
    set({ sending: true, streaming: '', error: null });
    const result = (await window.selfos?.togetherRetry({ sessionId: open.id })) ?? NOT_ALLOWED;
    if (result.ok) set({ open: result.view, sending: false, streaming: '' });
    else set({ sending: false, streaming: '', error: result.message });
    return result;
  },
  markRead: async (id) => {
    await window.selfos?.togetherMarkRead({ sessionId: id, at: new Date().toISOString() });
  },
  leave: async (id) => {
    const view = (await window.selfos?.togetherLeave(id)) ?? null;
    if (view && get().open?.id === id) set({ open: view });
    await get().refresh();
  },
  setPaused: async (id, paused) => {
    const view = (await window.selfos?.togetherSetPaused({ sessionId: id, paused })) ?? null;
    if (view && get().open?.id === id) set({ open: view });
    await get().refresh();
  },
  loadPrescreen: async () => {
    const prescreen = (await window.selfos?.togetherPrescreenGet()) ?? null;
    set({ prescreen });
  },
  submitPrescreen: async (answers) => {
    const result = (await window.selfos?.togetherPrescreenSubmit({ answers })) ?? HELD_PRESCREEN;
    await get().loadPrescreen();
    return result;
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
    return agreement;
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
      prescreen: null,
      catalog: [],
      reportView: EMPTY_REPORT,
      wrappingUp: false,
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
