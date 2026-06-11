import { create } from 'zustand';
import type { Answer, InboxAssignmentDetail, InboxItem } from '@shared/channels';

/**
 * The active person's Inbox (08-questionnaires §3.3) — questionnaires sent to them. Per-person state:
 * it must `reset()` when the signed-in person changes (AppShell keys an effect on the active person),
 * so one account's Inbox never lingers into another's view.
 */
interface InboxState {
  items: InboxItem[];
  loaded: boolean;
  load: () => Promise<void>;
  reset: () => void;
  getDetail: (assignmentId: string) => Promise<InboxAssignmentDetail | null>;
  open: (assignmentId: string) => Promise<void>;
  saveProgress: (assignmentId: string, answers: Answer[]) => Promise<void>;
  submit: (assignmentId: string, answers: Answer[]) => Promise<void>;
  decline: (assignmentId: string, note?: string) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    const items = (await window.selfos?.assignmentsInbox()) ?? [];
    set({ items, loaded: true });
  },
  reset: () => set({ items: [], loaded: false }),
  getDetail: async (assignmentId) => (await window.selfos?.assignmentsGet(assignmentId)) ?? null,
  open: async (assignmentId) => {
    await window.selfos?.assignmentsOpen(assignmentId);
    await get().load();
  },
  saveProgress: async (assignmentId, answers) => {
    await window.selfos?.assignmentsSaveProgress({ assignmentId, answers });
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
}));

/** Count of Inbox items still awaiting the recipient (drives the nav badge). */
export function unansweredCount(items: InboxItem[]): number {
  return items.filter((i) => i.answerable).length;
}
