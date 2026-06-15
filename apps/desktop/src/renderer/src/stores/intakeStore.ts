import { create } from 'zustand';
import type { IntakeAnswerValue, IntakeState } from '@shared/channels';
import { useBudgetStore } from './budgetStore';

/**
 * The active person's getting-to-know-you intake (18-personal-onboarding §5). Per-person — `reset()` runs on
 * an active-person switch (AppShell), so one person's intake never leaks into another's view. Interview turns
 * + synthesis flow through the bridge; streamed reply chunks arrive via `onIntakeChunk` → `appendChunk`.
 */
interface IntakeStoreState {
  state: IntakeState | null;
  loaded: boolean;
  streaming: string; // the in-flight interviewer reply buffer
  running: boolean; // an interview turn is streaming
  busy: boolean; // a skip / ack / section-complete call is in flight
  finalizing: boolean; // the final portrait synthesis is in flight
  error: string | null;
  load: () => Promise<void>;
  appendChunk: (delta: string) => void;
  runTurn: (sectionId: string, userText: string) => Promise<void>;
  skipSection: (sectionId: string) => Promise<void>;
  /** Submit a structured form section's answers (no AI). Fills the profile + marks the section complete. */
  submitForm: (sectionId: string, answers: Record<string, IntakeAnswerValue>) => Promise<void>;
  acknowledgeAdult: () => Promise<void>;
  /** Finish a section: marks it complete + generates a light reflection (best-effort). */
  completeSection: (sectionId: string) => Promise<void>;
  /** Generate the closing portrait (the explicit, bigger spend). Returns true on success. */
  finishIntake: () => Promise<boolean>;
  reset: () => void;
}

const EMPTY = {
  state: null,
  loaded: false,
  streaming: '',
  running: false,
  busy: false,
  finalizing: false,
  error: null,
} satisfies Partial<IntakeStoreState>;

export const useIntakeStore = create<IntakeStoreState>((set, get) => ({
  ...EMPTY,
  load: async () => {
    const state = (await window.selfos?.intakeGetState()) ?? null;
    set({ state, loaded: true });
  },
  appendChunk: (delta) => set((s) => ({ streaming: s.streaming + delta })),
  runTurn: async (sectionId, userText) => {
    const trimmed = userText.trim();
    if (!trimmed || get().running) return;
    set({ running: true, streaming: '', error: null });
    const result = await window.selfos?.intakeRunTurn({ sectionId, userText: trimmed });
    if (result?.ok) {
      set((s) => ({
        running: false,
        streaming: '',
        state: s.state ? { ...s.state, session: result.session } : s.state,
      }));
      await useBudgetStore.getState().refresh();
    } else {
      set({ running: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
  },
  skipSection: async (sectionId) => {
    set({ busy: true, error: null });
    const next = (await window.selfos?.intakeSkipSection({ sectionId })) ?? null;
    set({ busy: false, ...(next ? { state: next } : {}) });
  },
  submitForm: async (sectionId, answers) => {
    set({ busy: true, error: null });
    const next = (await window.selfos?.intakeSubmitForm({ sectionId, answers })) ?? null;
    set({ busy: false, ...(next ? { state: next } : {}) });
  },
  acknowledgeAdult: async () => {
    set({ busy: true, error: null });
    const next = (await window.selfos?.intakeAcknowledgeAdult()) ?? null;
    set({ busy: false, ...(next ? { state: next } : {}) });
  },
  completeSection: async (sectionId) => {
    set({ busy: true, error: null });
    const result = await window.selfos?.intakeSynthesize({ sectionId });
    if (result?.ok) {
      set((s) => ({
        busy: false,
        state: s.state ? { ...s.state, session: result.session } : s.state,
      }));
      await useBudgetStore.getState().refresh();
    } else {
      set({ busy: false, error: result?.message ?? 'Couldn’t finish this section.' });
    }
  },
  finishIntake: async () => {
    if (get().finalizing) return false;
    set({ finalizing: true, error: null });
    const result = await window.selfos?.intakeSynthesize({});
    if (result?.ok) {
      set((s) => ({
        finalizing: false,
        state: s.state ? { ...s.state, session: result.session } : s.state,
      }));
      await useBudgetStore.getState().refresh();
      return true;
    }
    set({ finalizing: false, error: result?.message ?? 'The portrait couldn’t be written.' });
    return false;
  },
  reset: () => set({ ...EMPTY }),
}));
