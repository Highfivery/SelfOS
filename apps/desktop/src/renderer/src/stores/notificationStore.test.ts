import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonNotificationState } from '@shared/channels';
import { selectUnreadCount, useNotificationStore } from './notificationStore';
import type { NotificationCandidate } from '../app/notifications/notificationKinds';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

const conflict: NotificationCandidate = {
  kind: 'sync-conflict',
  coalesceKey: 'sync-conflict',
  signature: '2',
  title: 'Sync conflicts found',
};

afterEach(() => {
  clearMockBridge();
  useNotificationStore.getState().reset();
});

describe('notificationStore', () => {
  it('does not resolve candidates until the persisted state has loaded', () => {
    installMockBridge();
    useNotificationStore.getState().setCandidates([conflict]);
    // Before load(): empty, so nothing toasts against unknown read/dismissed state.
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('loads persisted state and resolves read/dismissed flags', async () => {
    const persisted: PersonNotificationState = { read: { 'sync-conflict': '1' }, dismissed: {} };
    installMockBridge({ getNotificationState: () => Promise.resolve(persisted) });
    useNotificationStore.getState().setCandidates([conflict]);
    await useNotificationStore.getState().load();
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    // read at signature '1' but the current count is '2' (more) → unread again (sync-conflict re-surfaces).
    expect(notifications[0]?.read).toBe(false);
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(1);
  });

  it('marks one slot read and persists the signature', async () => {
    const setNotificationState = vi.fn(() => Promise.resolve());
    installMockBridge({ setNotificationState });
    useNotificationStore.getState().setCandidates([conflict]);
    await useNotificationStore.getState().load();

    useNotificationStore.getState().markRead('sync-conflict');
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(0);
    expect(setNotificationState).toHaveBeenLastCalledWith({
      read: { 'sync-conflict': '2' },
      dismissed: {},
    });
  });

  it('dismiss removes the item from the list and persists read + dismissed', async () => {
    const setNotificationState = vi.fn(() => Promise.resolve());
    installMockBridge({ setNotificationState });
    useNotificationStore.getState().setCandidates([conflict]);
    await useNotificationStore.getState().load();

    useNotificationStore.getState().dismiss('sync-conflict');
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(setNotificationState).toHaveBeenLastCalledWith({
      read: { 'sync-conflict': '2' },
      dismissed: { 'sync-conflict': '2' },
    });
  });

  it('reset clears everything (per-person isolation on a switch)', async () => {
    installMockBridge();
    useNotificationStore.getState().setCandidates([conflict]);
    await useNotificationStore.getState().load();
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    useNotificationStore.getState().reset();
    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.candidates).toHaveLength(0);
    expect(state.loaded).toBe(false);
    expect(state.persisted).toEqual({ read: {}, dismissed: {} });
    expect(state.toastedIds).toHaveLength(0);
  });
});
