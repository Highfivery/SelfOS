import { create } from 'zustand';
import type { ChatMessage, DreamAnalysis, DreamAnalysisEdits } from '@shared/schemas';
import { useBudgetStore } from './budgetStore';
import { useDreamStore } from './dreamStore';

/**
 * The guided dream-analysis surface state (12-dreams §3.2/§3.3). One dream at a time: its guided-chat
 * transcript + streamed reply, plus its synthesized `DreamAnalysis` and the approve→context lifecycle.
 * Per-person data — reset on the active-person change (wired into AppShell), like `conversationStore`.
 */
interface DreamAnalysisState {
  dreamId: string | null;
  messages: ChatMessage[];
  streaming: string;
  sending: boolean; // awaiting a guided turn
  synthesizing: boolean; // awaiting the synthesis
  approving: boolean;
  analysis: DreamAnalysis | null;
  error: string | null;
  /** Enter a dream's Analysis view: load its transcript + any existing analysis. */
  open: (dreamId: string) => Promise<void>;
  /** Send one guided-chat turn; the streamed reply arrives via `appendChunk`. */
  sendTurn: (text: string) => Promise<void>;
  /** Synthesize the dream (+ transcript) into a structured analysis. */
  synthesize: () => Promise<void>;
  /** Save the person's section edits; re-approves to keep an approved context in sync. */
  saveEdits: (edits: DreamAnalysisEdits) => Promise<void>;
  /** Approve the analysis into the coach's memory (→ Insight). */
  approve: () => Promise<void>;
  /** Un-approve: remove the analysis's Insight from context (the analysis itself stays). */
  removeFromContext: () => Promise<void>;
  appendChunk: (delta: string) => void;
  reset: () => void;
}

const EMPTY = {
  dreamId: null,
  messages: [] as ChatMessage[],
  streaming: '',
  sending: false,
  synthesizing: false,
  approving: false,
  analysis: null,
  error: null,
} satisfies Partial<DreamAnalysisState>;

export const useDreamAnalysisStore = create<DreamAnalysisState>((set, get) => ({
  ...EMPTY,
  open: async (dreamId) => {
    set({ ...EMPTY, dreamId });
    const [conversation, analysis] = await Promise.all([
      window.selfos?.dreamGetConversation(dreamId) ?? Promise.resolve(null),
      window.selfos?.dreamGetAnalysis(dreamId) ?? Promise.resolve(null),
    ]);
    // Guard against a late resolve after the user moved to a different dream.
    if (get().dreamId !== dreamId) return;
    set({ messages: conversation?.messages ?? [], analysis: analysis ?? null });
  },
  sendTurn: async (text) => {
    const trimmed = text.trim();
    const dreamId = get().dreamId;
    if (!trimmed || !dreamId || get().sending) return;
    set((state) => ({
      messages: [
        ...state.messages,
        { role: 'user', content: trimmed, ts: new Date().toISOString() },
      ],
      streaming: '',
      sending: true,
      error: null,
    }));
    const result = await window.selfos?.dreamAnalyzeTurn({ dreamId, userText: trimmed });
    if (result?.ok) {
      set({ messages: result.conversation.messages, streaming: '', sending: false });
      await useBudgetStore.getState().refresh(); // dream.analyze is metered → update the usage ring
      await useDreamStore.getState().load(); // status may flip captured → analyzing
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
  },
  synthesize: async () => {
    const dreamId = get().dreamId;
    if (!dreamId || get().synthesizing) return;
    set({ synthesizing: true, error: null });
    const result = await window.selfos?.dreamSynthesize({ dreamId });
    if (result?.ok) {
      set({ analysis: result.analysis, synthesizing: false });
      await useBudgetStore.getState().refresh();
      await useDreamStore.getState().load(); // status → analyzed
    } else {
      set({
        synthesizing: false,
        error: result?.message ?? 'The analysis couldn’t be written. Please try again.',
      });
    }
  },
  saveEdits: async (edits) => {
    const dreamId = get().dreamId;
    if (!dreamId) return;
    const updated = await window.selfos?.dreamUpdateAnalysis({ dreamId, edits });
    if (!updated) return;
    set({ analysis: updated });
    // If this analysis already feeds the coach, refresh its Insight so the context matches the edits
    // (approve is a cheap local distillation — no Claude call).
    if (updated.insightId) await window.selfos?.dreamApprove({ dreamId });
  },
  approve: async () => {
    const dreamId = get().dreamId;
    if (!dreamId || get().approving) return;
    set({ approving: true, error: null });
    const result = await window.selfos?.dreamApprove({ dreamId });
    if (result?.ok) {
      set((state) => ({
        approving: false,
        analysis: state.analysis
          ? { ...state.analysis, insightId: result.insightId }
          : state.analysis,
      }));
    } else {
      set({
        approving: false,
        error: result?.message ?? 'Couldn’t add this to your coaching context.',
      });
    }
  },
  removeFromContext: async () => {
    const dreamId = get().dreamId;
    if (!dreamId) return;
    await window.selfos?.dreamRemoveFromContext({ dreamId });
    set((state) => {
      if (!state.analysis) return {};
      const next = { ...state.analysis };
      delete next.insightId; // unlink — the analysis stays, just no longer feeds the coach
      return { analysis: next };
    });
  },
  appendChunk: (delta) => set((state) => ({ streaming: state.streaming + delta })),
  reset: () => set({ ...EMPTY }),
}));
