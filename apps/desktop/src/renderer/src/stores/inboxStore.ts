import { create } from 'zustand';
import type { Answer, InboxAssignmentDetail, InboxEntry, InboxItem } from '@shared/channels';

/**
 * The active person's Inbox (08-questionnaires §3.3) — questionnaires sent to them. Per-person state:
 * it must `reset()` when the signed-in person changes (AppShell keys an effect on the active person),
 * so one account's Inbox never lingers into another's view.
 */
interface InboxState {
  items: InboxItem[];
  /**
   * The cross-domain queue (08 §35) — check-ins alongside Together invitations, invitations to add to
   * someone's book, and books shared with you. `items` stays beside it because a check-in is ANSWERED here
   * and the answering pane needs the whole assignment; the queue row is enriched from it by id.
   */
  entries: InboxEntry[];
  loaded: boolean;
  load: () => Promise<void>;
  reset: () => void;
  /** Pin/unpin a received questionnaire (device-local, per-person); reloads so the card reflects it. */
  setFavorite: (assignmentId: string, favorite: boolean) => Promise<void>;
  getDetail: (assignmentId: string) => Promise<InboxAssignmentDetail | null>;
  open: (assignmentId: string) => Promise<void>;
  saveProgress: (assignmentId: string, answers: Answer[]) => Promise<void>;
  reopen: (assignmentId: string) => Promise<void>;
  submit: (assignmentId: string, answers: Answer[]) => Promise<void>;
  decline: (assignmentId: string, note?: string) => Promise<void>;
  /** Remove a received questionnaire from the Inbox (#350): a self check-in is deleted, else dismissed. */
  dismiss: (assignmentId: string) => Promise<void>;
  /** Remove one QUEUE entry from your own inbox (08 §35.3) — vault-stored, so it stays gone on every device. */
  dismissEntry: (entryId: string) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  entries: [],
  loaded: false,
  load: async () => {
    const [items, entries] = await Promise.all([
      window.selfos?.assignmentsInbox() ?? Promise.resolve([]),
      window.selfos?.inboxList() ?? Promise.resolve([]),
    ]);
    set({ items, entries, loaded: true });
  },
  reset: () => set({ items: [], entries: [], loaded: false }),
  dismissEntry: async (entryId) => {
    const entries = (await window.selfos?.inboxDismiss(entryId)) ?? [];
    set({ entries });
  },
  setFavorite: async (assignmentId, favorite) => {
    // Optimistic flip so the star responds instantly; the bridge persists it (device-local, per-person).
    set({
      items: get().items.map((i) => (i.assignmentId === assignmentId ? { ...i, favorite } : i)),
    });
    await window.selfos?.assignmentsSetFavorite({ assignmentId, favorite });
  },
  getDetail: async (assignmentId) => (await window.selfos?.assignmentsGet(assignmentId)) ?? null,
  open: async (assignmentId) => {
    await window.selfos?.assignmentsOpen(assignmentId);
    await get().load();
  },
  saveProgress: async (assignmentId, answers) => {
    await window.selfos?.assignmentsSaveProgress({ assignmentId, answers });
    await get().load();
  },
  reopen: async (assignmentId) => {
    await window.selfos?.assignmentsReopen(assignmentId);
    await get().load();
  },
  submit: async (assignmentId, answers) => {
    await window.selfos?.assignmentsSubmit({ assignmentId, answers });
    await get().load();
  },
  decline: async (assignmentId, note) => {
    await window.selfos?.assignmentsDecline({
      assignmentId,
      ...(note !== undefined && note.trim() !== '' ? { note: note.trim() } : {}),
    });
    await get().load();
  },
  dismiss: async (assignmentId) => {
    await window.selfos?.assignmentsDismiss(assignmentId);
    await get().load();
  },
}));

/** Count of Inbox items still awaiting the recipient (drives the nav badge). */
export function unansweredCount(items: InboxItem[]): number {
  return items.filter((i) => i.answerable).length;
}
