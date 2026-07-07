import { create } from 'zustand';
import type { AttachmentRef, ChatMessage, Insight, SessionStatus } from '@shared/schemas';
import type {
  BudgetState,
  ChallengeDomain,
  ChatTurnResult,
  ConversationMeta,
  SessionCost,
} from '@shared/channels';
import type { PendingAttachment } from '../app/routes/sessions/downscaleImage';
import { useBudgetStore } from './budgetStore';
import { useChallengeStore } from './challengeStore';

type ChatTurnOk = Extract<ChatTurnResult, { ok: true }>;

/** The state patch applied on a successful turn — shared by `send` + `retry` so they can't drift. */
function successPatch(state: ConversationState, result: ChatTurnOk): Partial<ConversationState> {
  return {
    messages: result.conversation.messages,
    streaming: '',
    sending: false,
    error: null,
    // A continued turn reopens a completed session (chatService flips status server-side).
    activeStatus: result.conversation.status ?? 'inProgress',
    activeInsightStale: result.conversation.insightStale ?? false,
    // Structured guided exercises advance the stepper server-side (16 §3.3).
    activeGuideId: result.conversation.guideId ?? null,
    activeGuideStep: result.conversation.guideStep ?? null,
    // A fresh hint un-dismisses the suggestion so it can re-surface (decision: re-surface on a later hint).
    wrapUpSuggested: result.wrapUpSuggested ?? false,
    suggestionDismissed: result.wrapUpSuggested ? false : state.suggestionDismissed,
    // 52 §3.2 — a captured challenge surfaces the inline "Challenge set ✓" confirmation.
    challengeCreated: result.challengeCreated ?? state.challengeCreated,
    runningCostUsd: state.runningCostUsd + result.usage.costUsd,
  };
}

interface ConversationState {
  conversations: ConversationMeta[];
  sessionCosts: Record<string, SessionCost>;
  activeId: string | null;
  activeStatus: SessionStatus;
  activeInsightId: string | null;
  activeInsightStale: boolean;
  /** The guided exercise this session was started from (16-guided-sessions §4.2); null = free session. */
  activeGuideId: string | null;
  /** Current step index for a structured guided exercise; null otherwise. */
  activeGuideStep: number | null;
  messages: ChatMessage[];
  /** Decrypted attachment data URLs, keyed by attachment id (45 §5.5) — avoids re-fetching a thumbnail. */
  attachmentUrls: Record<string, string>;
  streaming: string;
  sending: boolean;
  /** AI's turn-embedded "this feels wrapped up" hint for the open session (09 §14.1). */
  wrapUpSuggested: boolean;
  /** A challenge captured from a coach marker this turn (52 §3.2) — drives the inline "Challenge set ✓"
   *  confirmation; null until/after one is created. */
  challengeCreated: { id: string; action: string } | null;
  /** The suggestion is dismissed for now; a later hint re-surfaces it (user decision 2026-06-14). */
  suggestionDismissed: boolean;
  summarizing: boolean;
  /** The wrap-up card produced by the last summarize, shown inline; null until summarized this view. */
  wrapUp: Insight | null;
  runningCostUsd: number;
  budget: { person: BudgetState; app: BudgetState } | null;
  error: string | null;
  load: () => Promise<void>;
  newConversation: () => void;
  /** Start a guided session from a catalog exercise (16 §3.3); opens it. Returns the new id, or null. */
  startGuided: (guideId: string) => Promise<string | null>;
  /** Start a challenge-coach session (52 §3.1), optionally domain-seeded; opens it. Returns the id, or null. */
  startChallenge: (domain?: ChallengeDomain) => Promise<string | null>;
  /** Start a challenge REFLECTION session for a non-adult challenge (52 §3.5); opens it. */
  startChallengeReflection: (challengeId: string) => Promise<string | null>;
  /** Dismiss the inline "Challenge set ✓" confirmation. */
  dismissChallengeCreated: () => void;
  open: (id: string) => Promise<void>;
  /** Send a message. Resolves `false` only when a total attachment-store failure aborted before sending (so
   *  the composer can keep the pending thumbnails to retry); `true` otherwise. */
  send: (text: string, attachments?: PendingAttachment[]) => Promise<boolean>;
  /** Re-run the last (failed) turn — re-sends the last user message without adding a new bubble. No-op unless
   *  the last message is the user's (an incomplete turn). Used by the "Try again" affordance on an error. */
  retry: () => Promise<void>;
  /** Resolve + cache a stored attachment's data URL for a thumbnail/lightbox (45 §3.3). */
  loadAttachment: (ref: AttachmentRef) => Promise<void>;
  /** Export a stored attachment to a file outside the vault (45 §11); returns the saved path or null. */
  exportAttachment: (ref: AttachmentRef) => Promise<string | null>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setStatus: (id: string, status: SessionStatus) => Promise<void>;
  summarize: (id: string) => Promise<boolean>;
  dismissSuggestion: () => void;
  dismissWrapUp: () => void;
  appendChunk: (delta: string) => void;
  /** Clear all per-person state — called when the signed-in person changes (sessions are per-user). */
  reset: () => void;
}

const EMPTY = {
  conversations: [] as ConversationMeta[],
  sessionCosts: {} as Record<string, SessionCost>,
  activeId: null,
  activeStatus: 'inProgress' as SessionStatus,
  activeInsightId: null,
  activeInsightStale: false,
  activeGuideId: null,
  activeGuideStep: null,
  messages: [] as ChatMessage[],
  attachmentUrls: {} as Record<string, string>,
  streaming: '',
  sending: false,
  wrapUpSuggested: false,
  challengeCreated: null,
  suggestionDismissed: false,
  summarizing: false,
  wrapUp: null,
  runningCostUsd: 0,
  budget: null,
  error: null,
} satisfies Partial<ConversationState>;

export const useConversationStore = create<ConversationState>((set, get) => ({
  ...EMPTY,
  load: async () => {
    const conversations = (await window.selfos?.conversationsList()) ?? [];
    const budget = (await window.selfos?.budgetStatus()) ?? null;
    const sessionCosts = (await window.selfos?.usageSessionCosts()) ?? {};
    set({ conversations, budget, sessionCosts });
  },
  newConversation: () =>
    set({
      activeId: null,
      activeStatus: 'inProgress',
      activeInsightId: null,
      activeInsightStale: false,
      activeGuideId: null,
      activeGuideStep: null,
      messages: [],
      attachmentUrls: {},
      streaming: '',
      runningCostUsd: 0,
      wrapUpSuggested: false,
      challengeCreated: null,
      suggestionDismissed: false,
      wrapUp: null,
      error: null,
    }),
  startGuided: async (guideId) => {
    const result = await window.selfos?.sessionsStartGuided({ guideId });
    if (!result) return null;
    await get().open(result.conversationId);
    await get().load();
    return result.conversationId;
  },
  startChallenge: async (domain) => {
    const result = await window.selfos?.challengesStart(domain ? { domain } : {});
    if (!result) return null;
    await get().open(result.conversationId);
    await get().load();
    return result.conversationId;
  },
  startChallengeReflection: async (challengeId) => {
    const result = await window.selfos?.challengesStartReflection({ challengeId });
    if (!result) return null;
    await get().open(result.conversationId);
    await get().load();
    return result.conversationId;
  },
  dismissChallengeCreated: () => set({ challengeCreated: null }),
  open: async (id) => {
    const conversation = (await window.selfos?.conversationsGet(id)) ?? null;
    set({
      activeId: id,
      activeStatus: conversation?.status ?? 'inProgress',
      activeInsightId: conversation?.insightId ?? null,
      activeInsightStale: conversation?.insightStale ?? false,
      activeGuideId: conversation?.guideId ?? null,
      activeGuideStep: conversation?.guideStep ?? null,
      messages: conversation?.messages ?? [],
      attachmentUrls: {},
      streaming: '',
      runningCostUsd: 0,
      wrapUpSuggested: false,
      suggestionDismissed: false,
      wrapUp: null,
      error: null,
    });
  },
  send: async (text, attachments = []) => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || get().sending) return true;
    let conversationId = get().activeId;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      set({ activeId: conversationId });
    }
    // Store-on-send (45 §3.2/§11): encrypt each pending image to the vault, collecting the refs. A failed
    // store surfaces a calm error but never blocks the rest; the in-memory preview seeds the thumbnail cache
    // so the just-sent image renders instantly (no getAttachment round-trip).
    const refs: AttachmentRef[] = [];
    const urls: Record<string, string> = {};
    let storeError: string | null = null;
    for (const pending of attachments) {
      const stored = await window.selfos?.conversationStoreAttachment({
        conversationId,
        base64: pending.base64,
        mime: pending.mime,
        width: pending.width,
        height: pending.height,
        bytes: pending.bytes,
      });
      if (stored && !('ok' in stored)) {
        refs.push(stored);
        urls[stored.id] = pending.previewUrl;
      } else {
        storeError = stored && 'message' in stored ? stored.message : 'Couldn’t attach that image.';
      }
    }
    if (refs.length === 0 && !trimmed) {
      // Nothing could be stored and there's no text — abort and signal failure so the composer keeps the
      // pending thumbnails for a retry (rather than silently losing the user's images).
      set({ error: storeError ?? 'Couldn’t attach that image.' });
      return false;
    }
    set((state) => ({
      messages: [
        ...state.messages,
        {
          role: 'user',
          content: trimmed,
          ts: new Date().toISOString(),
          ...(refs.length > 0 ? { attachments: refs } : {}),
        },
      ],
      attachmentUrls: { ...state.attachmentUrls, ...urls },
      streaming: '',
      sending: true,
      wrapUp: null,
      error: storeError,
    }));
    const result = await window.selfos?.chatStream({
      conversationId,
      userText: trimmed,
      ...(refs.length > 0 ? { attachments: refs } : {}),
    });
    if (result?.ok) {
      set((state) => successPatch(state, result));
      await get().load();
      // Refresh the per-person challenge tracker so a just-captured challenge appears immediately (52 §3.2).
      if (result.challengeCreated) await useChallengeStore.getState().load();
      await useBudgetStore.getState().refresh(); // update the global usage header
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
    return true; // a turn was attempted (attachments stored) — don't restore pending in the composer
  },
  retry: async () => {
    // Re-run the last turn after a failure (empty reply, transport error, …) — the user's message is still on
    // screen (and its attachments already stored), so we re-send it WITHOUT adding a second bubble. Only fires
    // when the last message is the user's (i.e. no assistant reply landed — an incomplete/failed turn).
    const state = get();
    if (state.sending || !state.activeId) return;
    const last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'user') return;
    set({ sending: true, streaming: '', error: null, wrapUp: null });
    const result = await window.selfos?.chatStream({
      conversationId: state.activeId,
      userText: last.content,
      ...(last.attachments && last.attachments.length > 0 ? { attachments: last.attachments } : {}),
    });
    if (result?.ok) {
      set((s) => successPatch(s, result));
      await get().load();
      if (result.challengeCreated) await useChallengeStore.getState().load();
      await useBudgetStore.getState().refresh();
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
  },
  loadAttachment: async (ref) => {
    if (get().attachmentUrls[ref.id]) return; // already cached (just-sent preview or a prior fetch)
    const conversationId = get().activeId;
    if (!conversationId) return;
    const got = await window.selfos?.conversationGetAttachment({ conversationId, path: ref.path });
    if (got) {
      set((state) => ({
        attachmentUrls: {
          ...state.attachmentUrls,
          [ref.id]: `data:${got.mime};base64,${got.dataBase64}`,
        },
      }));
    }
  },
  exportAttachment: async (ref) => {
    const conversationId = get().activeId;
    if (!conversationId) return null;
    return (
      (await window.selfos?.conversationExportAttachment({ conversationId, path: ref.path })) ??
      null
    );
  },
  rename: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await window.selfos?.conversationsRename({ id, title: trimmed });
    await get().load();
  },
  remove: async (id) => {
    await window.selfos?.conversationsDelete(id);
    if (get().activeId === id) get().newConversation();
    await get().load();
  },
  setStatus: async (id, status) => {
    const updated = await window.selfos?.sessionsSetStatus({ conversationId: id, status });
    if (id === get().activeId && updated) set({ activeStatus: updated.status });
    await get().load();
  },
  summarize: async (id) => {
    if (get().summarizing) return false;
    set({ summarizing: true, error: null });
    const result = await window.selfos?.sessionsEndAndSummarize({ conversationId: id });
    if (result?.ok) {
      set((state) => ({
        summarizing: false,
        wrapUp: id === state.activeId ? result.insight : state.wrapUp,
        ...(id === get().activeId
          ? {
              activeStatus: 'complete' as SessionStatus,
              activeInsightId: result.insight.id,
              activeInsightStale: false,
            }
          : {}),
      }));
      await get().load();
      await useBudgetStore.getState().refresh();
      return true;
    }
    set({ summarizing: false, error: result?.message ?? 'Couldn’t summarize this session.' });
    return false;
  },
  dismissSuggestion: () => set({ suggestionDismissed: true }),
  dismissWrapUp: () => set({ wrapUp: null }),
  appendChunk: (delta) => set((state) => ({ streaming: state.streaming + delta })),
  reset: () => set({ ...EMPTY }),
}));
