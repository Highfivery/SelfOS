import { create } from 'zustand';
import type { Notification, PersonNotificationState } from '@shared/channels';
import {
  resolveNotifications,
  unreadCount,
  type NotificationCandidate,
} from '../app/notifications/notificationKinds';

const EMPTY: PersonNotificationState = { read: {}, dismissed: {} };

/**
 * The notification center's per-person state (35-notification-system §5). Holds the live candidate list
 * (pushed by `useNotificationSources` from conflicts / suggestions / responses / the update check) plus the
 * device-local read/dismissed signatures, and derives the resolved `notifications` list. Reset + reloaded
 * on a person switch via the AppShell active-person effect (the per-person-isolation rule).
 */
interface NotificationStoreState {
  /** Device-local read/dismissed signatures for the active person. */
  persisted: PersonNotificationState;
  /** Raw candidates contributed by the sources hook. */
  candidates: NotificationCandidate[];
  /** The resolved list (coalesced, read/dismissed applied, newest first) — what the UI renders. */
  notifications: Notification[];
  /** True once the persisted state has been read for the active person. */
  loaded: boolean;
  /** Notification ids already surfaced as a toast this session (so a recompute never re-toasts the same). */
  toastedIds: string[];
  load: () => Promise<void>;
  reset: () => void;
  setCandidates: (candidates: NotificationCandidate[]) => void;
  /** Mark one slot read at its current signature (clears it from the unread badge). */
  markRead: (coalesceKey: string) => void;
  /** Mark every shown notification read. */
  markAllRead: () => void;
  /** Dismiss one slot (gone from the list until its condition recurs per the kind's rule). */
  dismiss: (coalesceKey: string) => void;
  /** Dismiss every shown notification. */
  dismissAll: () => void;
  /** Record that these notification ids have been shown as a toast. */
  markToasted: (ids: string[]) => void;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => {
  const recompute = (
    candidates: NotificationCandidate[],
    persisted: PersonNotificationState,
  ): Notification[] => resolveNotifications(candidates, persisted, new Date().toISOString());

  const persist = (next: PersonNotificationState): void => {
    set({ persisted: next, notifications: recompute(get().candidates, next) });
    void window.selfos?.setNotificationState(next);
  };

  return {
    persisted: EMPTY,
    candidates: [],
    notifications: [],
    loaded: false,
    toastedIds: [],
    load: async () => {
      const persisted = (await window.selfos?.getNotificationState()) ?? EMPTY;
      set({ persisted, loaded: true, notifications: recompute(get().candidates, persisted) });
    },
    reset: () =>
      set({ persisted: EMPTY, candidates: [], notifications: [], loaded: false, toastedIds: [] }),
    setCandidates: (candidates) =>
      // Until the persisted read/dismissed state has loaded, resolve to nothing — otherwise a dismissed
      // item would briefly read as unread (against empty state) and wrongly toast on launch.
      set({
        candidates,
        notifications: get().loaded ? recompute(candidates, get().persisted) : [],
      }),
    markRead: (coalesceKey) => {
      const item = get().notifications.find((n) => n.coalesceKey === coalesceKey);
      if (!item) return;
      const { persisted } = get();
      persist({ ...persisted, read: { ...persisted.read, [coalesceKey]: item.signature } });
    },
    markAllRead: () => {
      const { persisted, notifications } = get();
      const read = { ...persisted.read };
      for (const n of notifications) read[n.coalesceKey] = n.signature;
      persist({ ...persisted, read });
    },
    dismiss: (coalesceKey) => {
      const item = get().notifications.find((n) => n.coalesceKey === coalesceKey);
      if (!item) return;
      const { persisted } = get();
      // Dismissing also marks read so the badge never counts an item the user just cleared.
      persist({
        ...persisted,
        read: { ...persisted.read, [coalesceKey]: item.signature },
        dismissed: { ...persisted.dismissed, [coalesceKey]: item.signature },
      });
    },
    dismissAll: () => {
      const { persisted, notifications } = get();
      const read = { ...persisted.read };
      const dismissed = { ...persisted.dismissed };
      for (const n of notifications) {
        read[n.coalesceKey] = n.signature;
        dismissed[n.coalesceKey] = n.signature;
      }
      persist({ ...persisted, read, dismissed });
    },
    markToasted: (ids) => set({ toastedIds: [...new Set([...get().toastedIds, ...ids])] }),
  };
});

/** Selector: the unread count for the bell badge. */
export const selectUnreadCount = (s: NotificationStoreState): number =>
  unreadCount(s.notifications);
