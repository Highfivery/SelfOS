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
  error: null as string | null,
  draft: null as NoteDraftState | null,
};

export const useNoteStore = create<NoteState>((set, get) => ({
  ...EMPTY,

  load: async () => {
    set({ rows: (await window.selfos?.notesList()) ?? [], loaded: true });
  },

  loadRecipients: async () => {
    set({ recipients: (await window.selfos?.notesRecipients()) ?? [] });
  },

  setDraft: (draft) => set({ draft }),

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
    if (!draft) return null;
    const result =
      (await window.selfos?.notesSend({
        recipientPersonId: input.recipientPersonId,
        type: input.type,
        subject: draft.subject,
        body: draft.body,
        answers: draft.answers,
        drafted: input.drafted,
      })) ?? null;
    if (result?.ok) {
      set({ draft: null, error: null });
      await get().load();
    }
    return result;
  },

  setEmail: async (personId, email) => {
    await window.selfos?.peopleSetEmail({ personId, email });
    await get().loadRecipients();
  },

  remove: async (noteId) => {
    await window.selfos?.notesDelete({ noteId });
    await get().load();
  },

  reset: () => set({ ...EMPTY }),
}));
