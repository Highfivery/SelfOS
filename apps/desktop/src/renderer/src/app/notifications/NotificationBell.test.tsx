import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import type { NotificationCandidate } from './notificationKinds';
import { useNotificationStore } from '../../stores/notificationStore';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';

const conflict: NotificationCandidate = {
  kind: 'sync-conflict',
  coalesceKey: 'sync-conflict',
  signature: '2',
  title: 'Sync conflicts found',
  body: '2 sync conflict copies were found in your vault.',
  action: { type: 'reveal-vault' },
};

async function seed(candidates: NotificationCandidate[]): Promise<void> {
  useNotificationStore.getState().setCandidates(candidates);
  await useNotificationStore.getState().load();
}

const renderBell = (): void => {
  render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
};

afterEach(() => {
  clearMockBridge();
  useNotificationStore.getState().reset();
});

describe('NotificationBell', () => {
  it('shows the unread count in the badge and the accessible name', async () => {
    installMockBridge();
    await seed([conflict]);
    renderBell();
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('opening the center marks shown items read (badge clears) but keeps them listed', async () => {
    installMockBridge();
    await seed([conflict]);
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    // The row is still shown…
    expect(screen.getByText('Sync conflicts found')).toBeInTheDocument();
    // …but the badge is gone (no longer "N unread").
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('dismissing a row removes it from the center', async () => {
    installMockBridge();
    await seed([conflict]);
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByText('You’re all caught up.')).toBeInTheDocument();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('shows the caught-up empty state when there are no notifications', async () => {
    installMockBridge();
    await seed([]);
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('You’re all caught up.')).toBeInTheDocument();
  });
});
