import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Notification } from '@shared/channels';
import { NotificationCenter } from './NotificationCenter';

const items: Notification[] = [
  {
    id: 'sync-conflict#2',
    kind: 'sync-conflict',
    severity: 'warning',
    title: 'Sync conflicts found',
    body: '2 sync conflict copies were found in your vault.',
    action: { type: 'reveal-vault' },
    createdAt: new Date().toISOString(),
    coalesceKey: 'sync-conflict',
    signature: '2',
    read: false,
    dismissed: false,
  },
  {
    id: 'responses-arrived:q1#1',
    kind: 'responses-arrived',
    severity: 'info',
    title: 'New questionnaire responses',
    body: '“Weekly check-in” has a new response.',
    action: { type: 'navigate', to: '/questionnaires' },
    createdAt: new Date().toISOString(),
    coalesceKey: 'responses-arrived:q1',
    signature: '1',
    read: true,
    dismissed: false,
  },
];

const noop = (): void => {};

describe('NotificationCenter', () => {
  it('shows the caught-up empty state when there are no notifications', () => {
    render(
      <NotificationCenter
        notifications={[]}
        onAction={noop}
        onDismiss={noop}
        onDismissAll={noop}
        onMarkAllRead={noop}
      />,
    );
    expect(screen.getByText('You’re all caught up.')).toBeInTheDocument();
  });

  it('renders each notification with its title, body, and action', () => {
    render(
      <NotificationCenter
        notifications={items}
        onAction={noop}
        onDismiss={noop}
        onDismissAll={noop}
        onMarkAllRead={noop}
      />,
    );
    expect(screen.getByText('Sync conflicts found')).toBeInTheDocument();
    expect(screen.getByText('“Weekly check-in” has a new response.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('fires the per-row action and dismiss handlers', async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <NotificationCenter
        notifications={items}
        onAction={onAction}
        onDismiss={onDismiss}
        onDismissAll={noop}
        onMarkAllRead={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onAction).toHaveBeenCalledWith(items[0]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]!);
    expect(onDismiss).toHaveBeenCalledWith('sync-conflict');
  });

  it('offers mark-all-read (only when there is an unread item) and dismiss-all', async () => {
    const onMarkAllRead = vi.fn();
    const onDismissAll = vi.fn();
    render(
      <NotificationCenter
        notifications={items}
        onAction={noop}
        onDismiss={noop}
        onDismissAll={onDismissAll}
        onMarkAllRead={onMarkAllRead}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    expect(onDismissAll).toHaveBeenCalledTimes(1);
  });
});
