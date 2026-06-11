import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceInviteControl } from './DeviceInviteControl';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => clearMockBridge());

describe('DeviceInviteControl', () => {
  it('generates and reveals a one-time invite code', async () => {
    const invitesCreate = vi.fn(() =>
      Promise.resolve({ code: 'amber-tide-fox-quill-river-stone', expiresAt: '2026-06-17' }),
    );
    installMockBridge({ invitesCreate, invitesList: () => Promise.resolve([]) });
    render(<DeviceInviteControl personId="wife-1" displayName="Wife" />);

    await userEvent.click(screen.getByRole('button', { name: 'Generate invite code' }));
    expect(invitesCreate).toHaveBeenCalledWith({ personId: 'wife-1' });
    expect(await screen.findByText('amber-tide-fox-quill-river-stone')).toBeInTheDocument();
    // Shown-once warning is present.
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  it('shows a pending invite and cancels it', async () => {
    const invitesCancel = vi.fn(() => Promise.resolve());
    installMockBridge({
      invitesList: () =>
        Promise.resolve([
          { id: 'inv-1', personId: 'wife-1', createdAt: '', expiresAt: '2026-06-17T00:00:00.000Z' },
        ]),
      invitesCancel,
    });
    render(<DeviceInviteControl personId="wife-1" displayName="Wife" />);

    expect(await screen.findByText(/Invite pending/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(invitesCancel).toHaveBeenCalledWith({ id: 'inv-1' });
  });

  it('supersedes a pending invite on regenerate (cancels the old one first)', async () => {
    const invitesCancel = vi.fn(() => Promise.resolve());
    const invitesCreate = vi.fn(() =>
      Promise.resolve({ code: 'pine-moss-dawn-otter-reed-vale', expiresAt: '' }),
    );
    installMockBridge({
      invitesList: () =>
        Promise.resolve([
          { id: 'old-1', personId: 'wife-1', createdAt: '', expiresAt: '2026-06-17T00:00:00.000Z' },
        ]),
      invitesCancel,
      invitesCreate,
    });
    render(<DeviceInviteControl personId="wife-1" displayName="Wife" />);

    await screen.findByText(/Invite pending/);
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate code' }));
    expect(invitesCancel).toHaveBeenCalledWith({ id: 'old-1' });
    expect(invitesCreate).toHaveBeenCalledWith({ personId: 'wife-1' });
  });
});
