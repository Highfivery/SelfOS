import { create } from 'zustand';
import type {
  NoteAnswer,
  NoteDraftResult,
  NoteRecipient,
  NoteRow,
  NoteSendResult,
  NoteType,
} from '@selfos/core/schemas';

/**
 * The owner's Notes surface (76 §3). Per-person: reset on an active-person change like every other
 * person-scoped store, so one owner's drafts can never appear under another (the 2026-06-11 rule).
 *
 * `draft` is deliberately editable in place — the AI writes it, the owner owns it, and nothing is sent
 * until they say so.
 */

export interface NoteDraftState {
  subject: string;
  body: string;
  answers: NoteAnswer[];
}

interface NoteState {
  rows: NoteRow[];
  recipients: NoteRecipient[];
  loaded: boolean;
  /** In-flight AI draft. */
  drafting: boolean;
  /** In-flight send — the double-send guard, and what disables the Send button. */
  sending: boolean;
  /** An honest failure from the draft pass, shown in place rather than swallowed. */
  error: string | null;
  draft: NoteDraftState | null;

  load: () => Promise<void>;
  loadRecipients: () => Promise<void>;
  setDraft: (draft: NoteDraftState | null) => void;
  requestDraft: (input: {
    recipientPersonId: string;
    type: NoteType;
    intent: string;
  }) => Promise<void>;
  send: (input: {
    recipientPersonId: string;
    type: NoteType;
    drafted: 'ai' | 'self';
  }) => Promise<NoteSendResult | null>;
  setEmail: (personId: string, email: string) => Promise<void>;
  remove: (noteId: string) => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  rows: [] as NoteRow[],
  recipients: [] as NoteRecipient[],
  loaded: false,
  drafting: false,
  sending: false,
  error: null as string | null,
  draft: null as NoteDraftState | null,
};

export const useNoteStore = create<NoteState>((set, get) => ({
  ...EMPTY,

  load: async () => {
    // A read that throws (a corrupt record, a vault hiccup) must still settle `loaded`, or the surface
    // renders neither its rows nor its empty state — a header over a blank page.
    try {
      set({ rows: (await window.selfos?.notesList()) ?? [], loaded: true });
    } catch {
      set({ rows: [], loaded: true, error: 'Your notes could not be loaded. Try again.' });
    }
  },

  loadRecipients: async () => {
    try {
      set({ recipients: (await window.selfos?.notesRecipients()) ?? [] });
    } catch {
      set({ recipients: [] });
    }
  },

  // Clearing the draft clears the failure that was ABOUT it — otherwise the previous note's error
  // banner greets the next one before anything has been attempted.
  setDraft: (draft) => set(draft === null ? { draft, error: null } : { draft }),

  requestDraft: async (input) => {
    set({ drafting: true, error: null });
    let result: NoteDraftResult | undefined;
    try {
      result = await window.selfos?.notesDraft(input);
    } catch {
      result = undefined;
    }
    if (!result) {
      set({ drafting: false, error: 'The draft could not be started. Try again.' });
      return;
    }
    if (!result.ok) {
      // A FAILED draft must not fold its payload into the view — it would wipe whatever the owner had
      // already written or edited (the 75 §11.1 lesson). Keep the draft, surface the reason.
      set({ drafting: false, error: result.message });
      return;
    }
    set({
      drafting: false,
      error: null,
      draft: { subject: result.subject, body: result.body, answers: result.answers },
    });
  },

  send: async (input) => {
    const draft = get().draft;
    // `sending` is the double-send guard: without it two clicks before the first await resolves both
    // read a non-null draft, and two records + two emails go out.
    if (!draft || get().sending) return null;
    set({ sending: true, error: null });
    let result: NoteSendResult | null = null;
    try {
      result =
        (await window.selfos?.notesSend({
          recipientPersonId: input.recipientPersonId,
          type: input.type,
          subject: draft.subject,
          body: draft.body,
          answers: draft.answers,
          drafted: input.drafted,
        })) ?? null;
    } catch {
      result = null;
    }
    if (result?.ok) {
      set({ draft: null, error: null, sending: false });
      await get().load();
      return result;
    }
    // A refusal (`NO_RECIPIENT` — the person was deleted between choosing them and sending) or a
    // rejected write must SAY so. Swallowing it leaves a Send button that does nothing, forever.
    set({
      sending: false,
      error: result?.message ?? 'That note could not be sent. Try again.',
    });
    return result;
  },

  setEmail: async (personId, email) => {
    try {
      await window.selfos?.peopleSetEmail({ personId, email });
    } catch {
      set({ error: 'That address could not be saved. Try again.' });
      return;
    }
    await get().loadRecipients();
  },

  remove: async (noteId) => {
    try {
      await window.selfos?.notesDelete({ noteId });
    } catch {
      set({ error: 'That note could not be deleted. Try again.' });
      return;
    }
    await get().load();
  },

  reset: () => set({ ...EMPTY }),
}));
