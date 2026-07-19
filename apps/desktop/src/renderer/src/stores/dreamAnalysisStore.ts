import { create } from 'zustand';
import type {
  ChatMessage,
  DreamAnalysis,
  DreamAnalysisEdits,
  DreamShareTarget,
  Insight,
} from '@shared/schemas';
import { useBudgetStore } from './budgetStore';
import { useDreamStore } from './dreamStore';

/**
 * The guided dream-analysis surface state (12-dreams §3.2/§3.3). One dream at a time: its guided-chat
 * transcript + streamed reply, plus its synthesized `DreamAnalysis` and the approve→context lifecycle.
 * Per-person data — reset on the active-person change (wired into AppShell), like `conversationStore`.
 */
interface DreamAnalysisState {
  dreamId: string | null;
  /** True once `open()` has finished loading — so the coach-opener effect never races the initial load. */
  loaded: boolean;
  messages: ChatMessage[];
  streaming: string;
  opening: boolean; // awaiting the coach's opener (12 §15.4)
  sending: boolean; // awaiting a guided turn
  synthesizing: boolean; // awaiting the synthesis
  approving: boolean;
  /** The coach signalled (via `[[SELFOS:DREAM_READY]]`) it has enough to write an analysis (12 §15.4). */
  analysisReady: boolean;
  analysis: DreamAnalysis | null;
  /** The approved Insight this dream produced (facts + per-person sharing), once approved (12 §3.4). */
  insight: Insight | null;
  /** Related people the dreamer can share facts with (their relationship-graph relations). */
  shareTargets: DreamShareTarget[];
  error: string | null;
  /** Enter a dream's Analysis view: load its transcript + any existing analysis. */
  open: (dreamId: string) => Promise<void>;
  /** Have the coach open the reflection (first turn) referencing this dream; no-op if already opened. */
  startReflection: () => Promise<void>;
  /** Send one guided-chat turn; the streamed reply arrives via `appendChunk`. */
  sendTurn: (text: string) => Promise<void>;
  /** Re-generate the coach's reply when the transcript ends on an unanswered message (66 §3.2). */
  retryTurn: () => Promise<void>;
  /** Synthesize the dream (+ transcript) into a structured analysis. */
  synthesize: () => Promise<void>;
  /** Save the person's section edits; re-approves to keep an approved context in sync. */
  saveEdits: (edits: DreamAnalysisEdits) => Promise<void>;
  /** Approve the analysis into the coach's memory (→ Insight). */
  approve: () => Promise<void>;
  /** Un-approve: remove the analysis's Insight from context (the analysis itself stays). */
  removeFromContext: () => Promise<void>;
  /** Load the dream's Insight (facts + sharing) + the dreamer's share targets — once it's approved. */
  loadSharing: () => Promise<void>;
  /** Share/unshare a specific insight fact with a related person (12 §3.4). */
  setFactShare: (factId: string, withPersonId: string, share: boolean) => Promise<void>;
  appendChunk: (delta: string) => void;
  reset: () => void;
}

const EMPTY = {
  dreamId: null,
  loaded: false,
  messages: [] as ChatMessage[],
  streaming: '',
  opening: false,
  sending: false,
  synthesizing: false,
  approving: false,
  analysisReady: false,
  analysis: null,
  insight: null,
  shareTargets: [] as DreamShareTarget[],
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
    set({ messages: conversation?.messages ?? [], analysis: analysis ?? null, loaded: true });
    if (analysis?.insightId) await get().loadSharing();
  },
  startReflection: async () => {
    const dreamId = get().dreamId;
    // Only ever opens an EMPTY reflection — a transcript that already has messages just resumes (no spend).
    if (!dreamId || get().opening || get().messages.length > 0) return;
    set({ opening: true, streaming: '', error: null });
    const result = await window.selfos?.dreamStartReflection({ dreamId });
    if (get().dreamId !== dreamId) return; // moved on to another dream mid-open
    if (result?.ok) {
      set({ messages: result.conversation.messages, streaming: '', opening: false });
      await useBudgetStore.getState().refresh(); // the AI opener is metered → update the usage ring
      await useDreamStore.getState().load(); // status may flip captured → analyzing
    } else {
      set({
        opening: false,
        streaming: '',
        error: result?.message ?? 'Couldn’t open the reflection. Please try again.',
      });
    }
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
      // `analysisReady` is sticky — once the coach signals it has enough, the suggestion stays offered.
      set((s) => ({
        messages: result.conversation.messages,
        streaming: '',
        sending: false,
        analysisReady: s.analysisReady || Boolean(result.analysisReady),
      }));
      await useBudgetStore.getState().refresh(); // dream.analyze is metered → update the usage ring
      await useDreamStore.getState().load(); // status may flip captured → analyzing
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
  },
  retryTurn: async () => {
    const dreamId = get().dreamId;
    if (!dreamId || get().sending) return;
    // Adds no new user message — core re-generates a reply for the transcript as it already stands, so
    // the person's message can never be duplicated (66 §3.2).
    set({ streaming: '', sending: true, error: null });
    const result = await window.selfos?.dreamRetryTurn({ dreamId });
    if (result?.ok) {
      set((s) => ({
        messages: result.conversation.messages,
        streaming: '',
        sending: false,
        analysisReady: s.analysisReady || Boolean(result.analysisReady),
      }));
      await useBudgetStore.getState().refresh();
      await useDreamStore.getState().load();
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
    // (approve is a cheap local distillation — no Claude call), then reload its facts/sharing.
    if (updated.insightId) {
      await window.selfos?.dreamApprove({ dreamId });
      await get().loadSharing();
    }
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
      await get().loadSharing(); // the Insight (+ its shareable facts) now exists
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
      if (!state.analysis) return { insight: null };
      const next = { ...state.analysis };
      delete next.insightId; // unlink — the analysis stays, just no longer feeds the coach
      return { analysis: next, insight: null };
    });
  },
  loadSharing: async () => {
    const dreamId = get().dreamId;
    if (!dreamId) return;
    const [insight, shareTargets] = await Promise.all([
      window.selfos?.dreamGetInsight(dreamId) ?? Promise.resolve(null),
      window.selfos?.dreamShareTargets() ?? Promise.resolve([]),
    ]);
    if (get().dreamId !== dreamId) return;
    set({ insight: insight ?? null, shareTargets: shareTargets ?? [] });
  },
  setFactShare: async (factId, withPersonId, share) => {
    const dreamId = get().dreamId;
    if (!dreamId) return;
    const result = await window.selfos?.dreamSetFactShare({ dreamId, factId, withPersonId, share });
    // Re-fetch so the toggle reflects the persisted truth (it snaps back if the share was refused).
    const insight = (await window.selfos?.dreamGetInsight(dreamId)) ?? null;
    if (get().dreamId !== dreamId) return;
    set({
      insight,
      ...(result && !result.ok ? { error: 'Couldn’t update sharing — please try again.' } : {}),
    });
  },
  appendChunk: (delta) => set((state) => ({ streaming: state.streaming + delta })),
  reset: () => set({ ...EMPTY }),
}));
