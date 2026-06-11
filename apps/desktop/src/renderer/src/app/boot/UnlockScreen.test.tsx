import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnlockScreen } from './UnlockScreen';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';
import { useSessionStore } from '../../stores/sessionStore';

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ status: null, activePerson: null, access: null, loaded: false });
});

describe('UnlockScreen', () => {
  it('disables Unlock until a recovery phrase is entered', () => {
    installMockBridge();
    render(<UnlockScreen />);
    expect(
      screen.getByRole('heading', { name: 'This vault is already set up' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('restores the device key from the (trimmed) recovery phrase', async () => {
    const unlockWithRecoveryPhrase = vi.fn(() => Promise.resolve({ ok: true }));
    installMockBridge({ unlockWithRecoveryPhrase });
    render(<UnlockScreen />);

    await userEvent.type(screen.getByLabelText('Recovery phrase'), '  my recovery phrase  ');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(unlockWithRecoveryPhrase).toHaveBeenCalledWith({ phrase: 'my recovery phrase' });
  });

  it('shows an error on a non-matching phrase and keeps the input', async () => {
    installMockBridge({ unlockWithRecoveryPhrase: () => Promise.resolve({ ok: false }) });
    render(<UnlockScreen />);

    await userEvent.type(screen.getByLabelText('Recovery phrase'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText(/match this vault/)).toBeInTheDocument();
    expect(screen.getByLabelText('Recovery phrase')).toHaveValue('nope');
  });

  it('redeems an invite code, then sets a PIN to finish joining', async () => {
    const invitesRedeem = vi.fn(() => Promise.resolve({ ok: true, displayName: 'Wife' }));
    const invitesCompleteJoin = vi.fn(() => Promise.resolve({ ok: true }));
    installMockBridge({ invitesRedeem, invitesCompleteJoin });
    render(<UnlockScreen />);

    await userEvent.click(screen.getByRole('button', { name: /have an invite code/i }));
    await userEvent.type(screen.getByLabelText('Invite code'), 'amber-tide-fox-quill-river-stone');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(invitesRedeem).toHaveBeenCalledWith({ code: 'amber-tide-fox-quill-river-stone' });

    // The PIN step, addressed to the resolved member.
    expect(await screen.findByRole('heading', { name: 'Set your PIN' })).toBeInTheDocument();
    expect(screen.getByText(/Wife/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your PIN'), '1234');
    await userEvent.type(screen.getByLabelText('Confirm PIN'), '1234');
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(invitesCompleteJoin).toHaveBeenCalledWith({ pin: '1234' });
  });

  it('shows an error on a bad invite code', async () => {
    installMockBridge({ invitesRedeem: () => Promise.resolve({ ok: false }) });
    render(<UnlockScreen />);

    await userEvent.click(screen.getByRole('button', { name: /have an invite code/i }));
    await userEvent.type(screen.getByLabelText('Invite code'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/match or has expired/)).toBeInTheDocument();
  });
});
