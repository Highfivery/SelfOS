import { create } from 'zustand';
import type { IntakeAnswerValue, IntakeState, RelationshipType } from '@shared/channels';
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
  /** Re-answer a section whose transcript ends on an unanswered message (66 §3.2). */
  retryTurn: (sectionId: string) => Promise<void>;
  /** "Delete from here" — drop this message and everything after it (66 §3.3). */
  rewind: (sectionId: string, index: number) => Promise<void>;
  /** "Retry from here" — truncate to this point, then re-generate (66 §3.3). */
  regenerateFrom: (sectionId: string, index: number) => Promise<void>;
  skipSection: (sectionId: string) => Promise<void>;
  /** Submit a structured form section's answers (no AI). Fills the profile + marks the section complete.
   * `sharing` carries the per-question relationship-type scopes (43); unset questions default server-side. */
  submitForm: (
    sectionId: string,
    answers: Record<string, IntakeAnswerValue>,
    sharing?: Record<string, RelationshipType[]>,
  ) => Promise<void>;
  /**
   * Silent background save (auto-save on edit, 43-followup): persists a completed section's answers + sharing
   * the instant they change, WITHOUT the `busy` toggle so the editing controls never flicker. Same write as
   * `submitForm` (the bridge re-persists `answerSharing`); used by the debounced auto-save on a complete section.
   */
  autoSaveForm: (
    sectionId: string,
    answers: Record<string, IntakeAnswerValue>,
    sharing?: Record<string, RelationshipType[]>,
  ) => Promise<void>;
  acknowledgeAdult: () => Promise<void>;
  /** Finish a section: marks it complete + generates a light reflection (best-effort). */
  completeSection: (sectionId: string) => Promise<void>;
  /** Generate the closing portrait (the explicit, bigger spend). Returns true on success. */
  finishIntake: () => Promise<boolean>;
  reset: () => void;
}

/** A section's transcript, or empty — the rewind actions need it to build the staleness stamp. */
function messagesOf(
  state: Pick<IntakeStoreState, 'state'>,
  sectionId: string,
): { role: 'user' | 'assistant'; ts: string }[] {
  return state.state?.session?.sections.find((s) => s.id === sectionId)?.messages ?? [];
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
  retryTurn: async (sectionId) => {
    if (get().running) return;
    // Adds no new user message — core re-answers the section transcript as it already stands (66 §3.2).
    set({ running: true, streaming: '', error: null });
    const result = await window.selfos?.intakeRetryTurn({ sectionId });
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
  rewind: async (sectionId, index) => {
    // "Delete from here" (66 §3.3). Rewinds the CONVERSATION only — structured form answers are written
    // separately and stay put, so this never silently unpicks fields the person filled in.
    const messages = messagesOf(get(), sectionId);
    const target = messages[index];
    if (get().running || !target) return;
    const result = await window.selfos?.intakeRewind({
      sectionId,
      index,
      expect: { role: target.role, ts: target.ts },
    });
    if (result?.ok) {
      set((s) => ({
        state: s.state ? { ...s.state, session: result.session } : s.state,
        error: null,
      }));
    } else {
      set({
        error:
          result?.reason === 'STALE'
            ? 'This section moved on — reopen it and try again.'
            : 'Couldn’t remove those messages.',
      });
    }
  },
  regenerateFrom: async (sectionId, index) => {
    const messages = messagesOf(get(), sectionId);
    const target = messages[index];
    if (get().running || !target) return;
    set({ running: true, streaming: '', error: null });
    const result = await window.selfos?.intakeRegenerateFrom({
      sectionId,
      index,
      expect: { role: target.role, ts: target.ts },
    });
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
  submitForm: async (sectionId, answers, sharing) => {
    set({ busy: true, error: null });
    const next =
      (await window.selfos?.intakeSubmitForm({
        sectionId,
        answers,
        ...(sharing ? { sharing } : {}),
      })) ?? null;
    set({ busy: false, ...(next ? { state: next } : {}) });
  },
  autoSaveForm: async (sectionId, answers, sharing) => {
    // No `busy` toggle — a background save, so the form's controls don't flicker as the user edits. And
    // `complete: false` — a draft save, so editing/answering NEVER prematurely completes the section (only the
    // explicit Continue/Done does), yet every answer + sharing change persists the moment it's made.
    const next =
      (await window.selfos?.intakeSubmitForm({
        sectionId,
        answers,
        complete: false,
        ...(sharing ? { sharing } : {}),
      })) ?? null;
    if (next) set({ state: next });
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
