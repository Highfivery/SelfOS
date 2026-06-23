import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastViewport } from './ToastViewport';
import type { NotificationCandidate } from './notificationKinds';
import { useNotificationStore } from '../../stores/notificationStore';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';

const responses: NotificationCandidate = {
  kind: 'responses-arrived',
  coalesceKey: 'responses-arrived:q1',
  signature: '1',
  title: 'New questionnaire responses',
  body: '“Weekly check-in” has a new response.',
  action: { type: 'navigate', to: '/questionnaires' },
};

afterEach(() => {
  clearMockBridge();
  useNotificationStore.getState().reset();
});

describe('ToastViewport', () => {
  it('toasts a newly-arrived unread notification, and the item persists in the center', async () => {
    installMockBridge();
    useNotificationStore.getState().setCandidates([responses]);
    await useNotificationStore.getState().load();

    render(
      <MemoryRouter>
        <ToastViewport />
      </MemoryRouter>,
    );

    // The toast appears (info → polite status region) with the title…
    expect(await screen.findByText('New questionnaire responses')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // …the id is marked toasted (so a recompute won't re-toast it)…
    expect(useNotificationStore.getState().toastedIds).toContain('responses-arrived:q1#1');
    // …and the notification still lives in the center.
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('renders nothing when there are no unread notifications', () => {
    installMockBridge();
    render(
      <MemoryRouter>
        <ToastViewport />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
