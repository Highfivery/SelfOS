import { create } from 'zustand';
import type { ChatMessage } from '@shared/schemas';
import type { BudgetState, ConversationMeta } from '@shared/channels';

interface ConversationState {
  conversations: ConversationMeta[];
  activeId: string | null;
  messages: ChatMessage[];
  streaming: string;
  sending: boolean;
  runningCostUsd: number;
  budget: { person: BudgetState; app: BudgetState } | null;
  error: string | null;
  load: () => Promise<void>;
  newConversation: () => void;
  open: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  appendChunk: (delta: string) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  streaming: '',
  sending: false,
  runningCostUsd: 0,
  budget: null,
  error: null,
  load: async () => {
    const conversations = (await window.selfos?.conversationsList()) ?? [];
    const budget = (await window.selfos?.budgetStatus()) ?? null;
    set({ conversations, budget });
  },
  newConversation: () =>
    set({ activeId: null, messages: [], streaming: '', runningCostUsd: 0, error: null }),
  open: async (id) => {
    const conversation = (await window.selfos?.conversationsGet(id)) ?? null;
    set({
      activeId: id,
      messages: conversation?.messages ?? [],
      streaming: '',
      runningCostUsd: 0,
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
      error: null,
    }));
    const result = await window.selfos?.chatStream({ conversationId, userText: trimmed });
    if (result?.ok) {
      set((state) => ({
        messages: result.conversation.messages,
        streaming: '',
        sending: false,
        runningCostUsd: state.runningCostUsd + result.usage.costUsd,
      }));
      await get().load();
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
  },
  remove: async (id) => {
    await window.selfos?.conversationsDelete(id);
    if (get().activeId === id) get().newConversation();
    await get().load();
  },
  appendChunk: (delta) => set((state) => ({ streaming: state.streaming + delta })),
}));
