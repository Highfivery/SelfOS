import { create } from 'zustand';
import type { ChatMessage, Insight, SessionStatus } from '@shared/schemas';
import type { BudgetState, ConversationMeta, SessionCost } from '@shared/channels';
import { useBudgetStore } from './budgetStore';

interface ConversationState {
  conversations: ConversationMeta[];
  sessionCosts: Record<string, SessionCost>;
  activeId: string | null;
  activeStatus: SessionStatus;
  activeInsightId: string | null;
  activeInsightStale: boolean;
  messages: ChatMessage[];
  streaming: string;
  sending: boolean;
  /** AI's turn-embedded "this feels wrapped up" hint for the open session (09 §14.1). */
  wrapUpSuggested: boolean;
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
  open: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
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
  messages: [] as ChatMessage[],
  streaming: '',
  sending: false,
  wrapUpSuggested: false,
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
      messages: [],
      streaming: '',
      runningCostUsd: 0,
      wrapUpSuggested: false,
      suggestionDismissed: false,
      wrapUp: null,
      error: null,
    }),
  open: async (id) => {
    const conversation = (await window.selfos?.conversationsGet(id)) ?? null;
    set({
      activeId: id,
      activeStatus: conversation?.status ?? 'inProgress',
      activeInsightId: conversation?.insightId ?? null,
      activeInsightStale: conversation?.insightStale ?? false,
      messages: conversation?.messages ?? [],
      streaming: '',
      runningCostUsd: 0,
      wrapUpSuggested: false,
      suggestionDismissed: false,
      wrapUp: null,
      error: null,
    });
  },
  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return;
    let conversationId = get().activeId;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      set({ activeId: conversationId });
    }
    set((state) => ({
      messages: [
        ...state.messages,
        { role: 'user', content: trimmed, ts: new Date().toISOString() },
      ],
      streaming: '',
      sending: true,
      wrapUp: null,
      error: null,
    }));
    const result = await window.selfos?.chatStream({ conversationId, userText: trimmed });
    if (result?.ok) {
      set((state) => ({
        messages: result.conversation.messages,
        streaming: '',
        sending: false,
        // A continued turn reopens a completed session (chatService flips status server-side).
        activeStatus: result.conversation.status ?? 'inProgress',
        activeInsightStale: result.conversation.insightStale ?? false,
        // A fresh hint un-dismisses the suggestion so it can re-surface (decision: re-surface on a later hint).
        wrapUpSuggested: result.wrapUpSuggested ?? false,
        suggestionDismissed: result.wrapUpSuggested ? false : state.suggestionDismissed,
        runningCostUsd: state.runningCostUsd + result.usage.costUsd,
      }));
      await get().load();
      await useBudgetStore.getState().refresh(); // update the global usage header
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
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
